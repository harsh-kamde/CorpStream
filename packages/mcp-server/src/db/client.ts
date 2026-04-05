import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

// Singleton pool — reused across Lambda warm invocations & MCP requests
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,                  // t2.micro has limited RAM — keep pool small
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }  // RDS requires SSL
        : false,
    });

    pool.on("error", (err) => {
      console.error("[DB] Pool error:", err.message);
    });
  }
  return pool;
}

export const db = drizzle(getPool(), { schema });

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
