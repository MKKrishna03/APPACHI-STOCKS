import type { PoolClient } from "pg";

export function getMonthPrefix(date = new Date()) {
  const month = date
    .toLocaleString("en-US", { month: "short", timeZone: "Asia/Kolkata" })
    .toUpperCase();
  const year = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "2-digit",
  }).format(date);
  return `${month}${year}`;
}

export async function nextQuotationNumber(client: PoolClient) {
  const prefix = getMonthPrefix();
  const { rows: countRows } = await client.query(
    "select count(*) as count from quotations where quotation_number like $1",
    [`${prefix}/%`]
  );
  const nextSeq = Number(countRows[0].count) + 1;
  return `${prefix}/${String(nextSeq).padStart(2, "0")}`;
}
