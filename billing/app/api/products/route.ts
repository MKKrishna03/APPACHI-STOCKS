import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const { rows } = await pool.query(
    "select * from products order by created_at desc"
  );
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
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

  if (!name || !category) {
    return NextResponse.json(
      { error: "name and category are required" },
      { status: 400 }
    );
  }

  const { rows } = await pool.query(
    `insert into products (name, category, product_group, purity, wastage_tier_1, wastage_tier_2, wastage_tier_3)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      name,
      category,
      productGroup || null,
      purity || null,
      wastageTier1 || null,
      wastageTier2 || null,
      wastageTier3 || null,
    ]
  );

  return NextResponse.json(rows[0], { status: 201 });
}
