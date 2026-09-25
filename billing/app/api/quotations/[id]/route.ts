import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { nextScrapNumber } from "@/lib/scrapNumber";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { rows } = await pool.query(
    "select * from quotations where id = $1",
    [id]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { rows: items } = await pool.query(
    `select i.*, p.wastage_tier_1 as product_wastage_tier_1,
            p.wastage_tier_2 as product_wastage_tier_2,
            p.wastage_tier_3 as product_wastage_tier_3
     from quotation_items i
     left join products p on p.id = i.product_id
     where i.quotation_id = $1
     order by i.created_at`,
    [id]
  );

  const { rows: scraps } = await pool.query(
    "select * from scraps where quotation_id = $1 order by created_at",
    [id]
  );

  return NextResponse.json({ ...rows[0], items, scraps });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await pool.query("delete from quotations where id = $1", [id]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { items, gst, total, less, netTotal, scraps } = body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `update quotations
       set gst = $1, total = $2, less = $3, net_total = $4,
           revision = revision + 1, updated_at = now()
       where id = $5
       returning *`,
      [gst, total, less, netTotal, id]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (Array.isArray(items)) {
      await client.query("delete from quotation_items where quotation_id = $1", [
        id,
      ]);
      for (const item of items) {
        await client.query(
          `insert into quotation_items
             (quotation_id, category, product_id, product_name, purity, weight,
              wastage_percent, wastage_weight, rate, mc, gst, amount)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id,
            item.category,
            item.productId || null,
            item.productName,
            item.purity || null,
            item.weight,
            item.wastagePercent,
            item.wastageWeight,
            item.rate,
            item.mc,
            item.gst,
            item.amount,
          ]
        );
      }
    }

    if (Array.isArray(scraps)) {
      for (const scrap of scraps) {
        const scrapNumber = await nextScrapNumber(client);
        await client.query(
          `insert into scraps (scrap_number, quotation_id, category, scrap_name, scrap_weight, status)
           values ($1,$2,$3,$4,$5,'pending')`,
          [scrapNumber, id, scrap.category, scrap.scrapName, scrap.scrapWeight]
        );
      }
    }

    await client.query("COMMIT");

    const { rows: itemRows } = await client.query(
      "select * from quotation_items where quotation_id = $1 order by created_at",
      [id]
    );

    return NextResponse.json({ ...rows[0], items: itemRows });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
