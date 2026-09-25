import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const {
    name,
    category,
    productGroup,
    purity,
    wastageTier1,
    wastageTier2,
    wastageTier3,
  } = body;

  const { rows } = await pool.query(
    `update products
     set name = $1, category = $2, product_group = $3, purity = $4,
         wastage_tier_1 = $5, wastage_tier_2 = $6, wastage_tier_3 = $7
     where id = $8
     returning *`,
    [
      name,
      category,
      productGroup || null,
      purity || null,
      wastageTier1 || null,
      wastageTier2 || null,
      wastageTier3 || null,
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
  await pool.query("delete from products where id = $1", [id]);
  return NextResponse.json({ ok: true });
}
