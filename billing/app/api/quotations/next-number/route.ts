import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getMonthPrefix } from "@/lib/quotationNumber";

export async function GET() {
  const prefix = getMonthPrefix();

  const { rows } = await pool.query(
    "select count(*) as count from quotations where quotation_number like $1",
    [`${prefix}/%`]
  );

  const nextSeq = Number(rows[0].count) + 1;
  const quotationNumber = `${prefix}/${String(nextSeq).padStart(2, "0")}`;

  return NextResponse.json({ quotationNumber });
}
