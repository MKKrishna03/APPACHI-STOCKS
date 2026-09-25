import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

function createPool() {
  const newPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });

  // Neon's pooler can drop idle sockets; without this handler an idle
  // client erroring out would crash the whole dev server.
  newPool.on("error", (err) => {
    console.error("pg pool idle client error:", err.message);
  });

  return newPool;
}

export const pool = global.pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global.pgPool = pool;
}
