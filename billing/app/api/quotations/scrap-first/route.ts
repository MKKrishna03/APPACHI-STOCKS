import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { nextQuotationNumber } from "@/lib/quotationNumber";
import { nextScrapNumber } from "@/lib/scrapNumber";

export async function POST(request: Request) {
  const body = await request.json();
  const { category, scrapName, scrapWeight, salesPerson } = body;

  if (!category || !scrapName || !scrapWeight) {
    return NextResponse.json(
      { error: "category, scrapName and scrapWeight are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const quotationNumber = await nextQuotationNumber(client);

    const { rows: qRows } = await client.query(
      `insert into quotations (quotation_number, revision, sales_person)
       values ($1, 1, $2)
       returning *`,
      [quotationNumber, salesPerson || null]
    );
    const quotation = qRows[0];

    const scrapNumber = await nextScrapNumber(client);
    const { rows: sRows } = await client.query(
      `insert into scraps (scrap_number, quotation_id, category, scrap_name, scrap_weight, status)
       values ($1,$2,$3,$4,$5,'pending')
       returning *`,
      [scrapNumber, quotation.id, category, scrapName, scrapWeight]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      { ...quotation, scrap: sRows[0] },
      { status: 201 }
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
