import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { rows } = await pool.query(
    `select s.*, q.quotation_number
     from scraps s
     left join quotations q on q.id = s.quotation_id
     where s.id = $1`,
    [id]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const {
    category,
    scrapName,
    scrapWeight,
    scrapLess,
    scrapWeightAfterLess,
    rate,
    total,
    markEstimated,
    lockEstimate,
    linkQuotationId,
  } = body;

  const { rows: existingRows } = await pool.query(
    "select status from scraps where id = $1",
    [id]
  );
  if (existingRows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existingRows[0].status === "locked") {
    return NextResponse.json(
      { error: "Scrap is locked and cannot be edited" },
      { status: 409 }
    );
  }

  if (linkQuotationId) {
    const { rows } = await pool.query(
      `update scraps set quotation_id = $1
       where id = $2 and quotation_id is null
       returning *`,
      [linkQuotationId, id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Scrap not found or already linked to a quotation" },
        { status: 409 }
      );
    }

    return NextResponse.json(rows[0]);
  }

  if ((markEstimated || lockEstimate) && !(rate > 0)) {
    return NextResponse.json(
      { error: "Rate is required to estimate or lock this scrap" },
      { status: 400 }
    );
  }

  const nextStatus = lockEstimate
    ? "locked"
    : markEstimated
      ? "estimated"
      : null;

  const { rows } = await pool.query(
    `update scraps
     set category = $1, scrap_name = $2, scrap_weight = $3, scrap_less = $4,
         scrap_weight_after_less = round($5::numeric, 3), rate = $6, total = round($7::numeric, 2),
         status = coalesce($8, status)
     where id = $9
     returning *`,
    [
      category,
      scrapName,
      scrapWeight,
      scrapLess,
      scrapWeightAfterLess,
      rate,
      total,
      nextStatus,
      id,
    ]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await pool.query("delete from scraps where id = $1", [id]);
  return NextResponse.json({ ok: true });
}
