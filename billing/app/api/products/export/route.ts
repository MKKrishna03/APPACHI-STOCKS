import ExcelJS from "exceljs";
import { pool } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const productGroup = searchParams.get("productGroup");

  const conditions: string[] = [];
  const values: string[] = [];

  if (category) {
    values.push(category);
    conditions.push(`category = $${values.length}`);
  }
  if (productGroup) {
    values.push(productGroup);
    conditions.push(`product_group = $${values.length}`);
  }

  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const { rows } = await pool.query(
    `select * from products ${where} order by created_at desc`,
    values
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");

  sheet.columns = [
    { header: "Ornament Type", key: "category", width: 15 },
    { header: "Product Group", key: "productGroup", width: 18 },
    { header: "Product Name", key: "name", width: 22 },
    { header: "Tier 1 WS", key: "tier1", width: 12 },
    { header: "Tier 2 WS", key: "tier2", width: 12 },
    { header: "Tier 3 WS", key: "tier3", width: 12 },
  ];

  for (const row of rows) {
    sheet.addRow({
      category: row.category,
      productGroup: row.product_group,
      name: row.name,
      tier1: row.wastage_tier_1,
      tier2: row.wastage_tier_2,
      tier3: row.wastage_tier_3,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="products.xlsx"',
    },
  });
}
