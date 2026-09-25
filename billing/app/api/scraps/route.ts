import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { nextScrapNumber } from "@/lib/scrapNumber";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const unlinked = searchParams.get("unlinked") === "true";

  const { rows } = await pool.query(
    `select s.*, q.quotation_number
     from scraps s
     left join quotations q on q.id = s.quotation_id
     ${unlinked ? "where s.quotation_id is null" : ""}
     order by s.created_at desc`
  );
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();
  const {
    category,
    scrapName,
    scrapWeight,
    scrapLess,
    scrapWeightAfterLess,
    rate,
    total,
  } = body;

  if (!category || !scrapName) {
    return NextResponse.json(
      { error: "category and scrapName are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scrapNumber = await nextScrapNumber(client);

    const { rows } = await client.query(
      `insert into scraps (scrap_number, category, scrap_name, scrap_weight, scrap_less, scrap_weight_after_less, rate, total)
       values ($1, $2, $3, $4, $5, round($6::numeric, 3), $7, round($8::numeric, 2))
       returning *`,
      [scrapNumber, category, scrapName, scrapWeight, scrapLess, scrapWeightAfterLess, rate, total]
    );

    await client.query("COMMIT");
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
