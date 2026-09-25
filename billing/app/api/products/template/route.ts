import ExcelJS from "exceljs";

export async function GET() {
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

  sheet.addRow({
    category: "Gold",
    productGroup: "Ring",
    name: "Casting Ring",
    tier1: 16,
    tier2: 14,
    tier3: 12,
  });

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="product_template.xlsx"',
    },
  });
}
