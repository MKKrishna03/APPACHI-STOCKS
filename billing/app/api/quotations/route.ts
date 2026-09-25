import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { nextQuotationNumber } from "@/lib/quotationNumber";
import { nextScrapNumber } from "@/lib/scrapNumber";

export async function GET() {
  const { rows } = await pool.query(
    `select q.*,
            coalesce(
              (select json_agg(i.* order by i.created_at) from quotation_items i where i.quotation_id = q.id),
              '[]'
            ) as items,
            coalesce(
              (select json_agg(s.* order by s.created_at) from scraps s where s.quotation_id = q.id),
              '[]'
            ) as scraps
     from quotations q
     order by q.created_at desc`
  );
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { items, gst, total, less, netTotal, scraps, salesPerson } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "At least one item is required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const quotationNumber = await nextQuotationNumber(client);

    const { rows: qRows } = await client.query(
      `insert into quotations (quotation_number, gst, total, less, net_total, revision, sales_person)
       values ($1,$2,$3,$4,$5,1,$6)
       returning *`,
      [quotationNumber, gst, total, less, netTotal, salesPerson || null]
    );
    const quotation = qRows[0];

    for (const item of items) {
      await client.query(
        `insert into quotation_items
           (quotation_id, category, product_id, product_name, purity, weight,
            wastage_percent, wastage_weight, rate, mc, gst, amount)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          quotation.id,
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

    if (Array.isArray(scraps)) {
      for (const scrap of scraps) {
        const scrapNumber = await nextScrapNumber(client);
        await client.query(
          `insert into scraps (scrap_number, quotation_id, category, scrap_name, scrap_weight, status)
           values ($1,$2,$3,$4,$5,'pending')`,
          [scrapNumber, quotation.id, scrap.category, scrap.scrapName, scrap.scrapWeight]
        );
      }
    }

    await client.query("COMMIT");

    const { rows: itemRows } = await client.query(
      "select * from quotation_items where quotation_id = $1 order by created_at",
      [quotation.id]
    );

    return NextResponse.json(
      { ...quotation, items: itemRows },
      { status: 201 }
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
