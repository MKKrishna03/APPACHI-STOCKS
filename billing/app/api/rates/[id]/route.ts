import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await pool.query("delete from rate_history where id = $1", [id]);
  return NextResponse.json({ ok: true });
}
