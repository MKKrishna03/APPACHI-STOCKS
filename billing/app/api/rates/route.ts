import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getIstDateAndSession } from "@/lib/rateTime";

export async function GET() {
  const selectSql =
    "select id, to_char(rate_date, 'YYYY-MM-DD') as rate_date, session, gold_rate, silver_rate, created_at from rate_history";

  const [currentResult, historyResult] = await Promise.all([
    pool.query(`${selectSql} order by created_at desc limit 1`),
    pool.query(`${selectSql} order by created_at desc limit 100`),
  ]);

  return NextResponse.json({
    current: currentResult.rows[0] ?? null,
    history: historyResult.rows,
    auto: getIstDateAndSession(),
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { goldRate, silverRate } = body;

  if (!goldRate || !silverRate) {
    return NextResponse.json(
      { error: "goldRate and silverRate are required" },
      { status: 400 }
    );
  }

  const auto = getIstDateAndSession();
  const date = body.date || auto.date;
  const session = body.session === "AM" || body.session === "PM"
    ? body.session
    : auto.session;

  const { rows } = await pool.query(
    `insert into rate_history (rate_date, session, gold_rate, silver_rate)
     values ($1, $2, $3, $4)
     returning id, to_char(rate_date, 'YYYY-MM-DD') as rate_date, session, gold_rate, silver_rate, created_at`,
    [date, session, goldRate, silverRate]
  );

  return NextResponse.json(rows[0], { status: 201 });
}
