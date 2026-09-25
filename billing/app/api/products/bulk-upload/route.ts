import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { pool } from "@/lib/db";

const HEADER_MAP: Record<string, string> = {
  "ornament type": "category",
  "product group": "productGroup",
  "product name": "name",
  "tier 1 ws": "tier1",
  "tier 2 ws": "tier2",
  "tier 3 ws": "tier3",
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];

  if (!sheet) {
    return NextResponse.json({ error: "No sheet found" }, { status: 400 });
  }

  const headerRow = sheet.getRow(1);
  const columnKeys: (string | null)[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = String(cell.value ?? "")
      .trim()
      .toLowerCase();
    columnKeys[colNumber] = HEADER_MAP[header] ?? null;
  });

  let inserted = 0;
  const errors: string[] = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;

    const record: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = columnKeys[colNumber];
      if (key) record[key] = cell.value;
    });

    const name = record.name ? String(record.name).trim() : "";
    const category = record.category ? String(record.category).trim() : "";

    if (!name && !category) continue;

    if (!name || (category !== "Gold" && category !== "Silver")) {
      errors.push(
        `Row ${rowNumber}: name and a valid Ornament Type (Gold/Silver) are required`
      );
      continue;
    }

    await pool.query(
      `insert into products (name, category, product_group, wastage_tier_1, wastage_tier_2, wastage_tier_3)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        name,
        category,
        record.productGroup ? String(record.productGroup).trim() : null,
        record.tier1 ?? null,
        record.tier2 ?? null,
        record.tier3 ?? null,
      ]
    );
    inserted++;
  }

  return NextResponse.json({ inserted, errors });
}
