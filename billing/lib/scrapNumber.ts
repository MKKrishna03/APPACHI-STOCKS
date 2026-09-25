import type { PoolClient } from "pg";
import { getMonthPrefix } from "./quotationNumber";

export async function nextScrapNumber(client: PoolClient) {
  const prefix = getMonthPrefix();
  const { rows } = await client.query(
    "select count(*) as count from scraps where scrap_number like $1",
    [`SC-${prefix}/%`]
  );
  const nextSeq = Number(rows[0].count) + 1;
  return `SC-${prefix}/${String(nextSeq).padStart(2, "0")}`;
}
