#!/usr/bin/env tsx
/**
 * scripts/seed-db.ts
 * Run after RDS is provisioned:
 *   npx tsx scripts/seed-db.ts
 *
 * Creates tables, indexes, and inserts a default API key.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sql } from "drizzle-orm";
import { apiKeys } from "../packages/mcp-server/src/db/schema.js";
import { randomBytes } from "crypto";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const db = drizzle(pool);

async function seed() {
  console.log("Creating tables...");

  // Create all tables via raw SQL (Drizzle push handles this, but useful for manual runs)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      reg_number        TEXT NOT NULL,
      country           TEXT NOT NULL,
      jurisdiction      TEXT DEFAULT '',
      inc_date          TEXT DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'active',
      company_type      TEXT DEFAULT '',
      reg_address       TEXT DEFAULT '',
      directors         TEXT[] DEFAULT '{}',
      sic               TEXT[] DEFAULT '{}',
      source            TEXT NOT NULL,
      source_url        TEXT DEFAULT '',
      scraped_at        TIMESTAMPTZ DEFAULT NOW(),
      raw_data          JSONB
    );

    CREATE TABLE IF NOT EXISTS scrape_runs (
      id                  TEXT PRIMARY KEY,
      source              TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      triggered_by        TEXT DEFAULT 'manual',
      companies_fetched   INTEGER DEFAULT 0,
      apify_run_id        TEXT,
      s3_csv_key          TEXT,
      days_back           INTEGER DEFAULT 1,
      limit_requested     INTEGER DEFAULT 100,
      started_at          TIMESTAMPTZ DEFAULT NOW(),
      completed_at        TIMESTAMPTZ,
      error               TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id           TEXT PRIMARY KEY,
      key          TEXT NOT NULL UNIQUE,
      label        TEXT DEFAULT '',
      is_active    BOOLEAN DEFAULT TRUE,
      rate_limit   INTEGER DEFAULT 100,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      last_used_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS country_idx  ON companies (country);
    CREATE INDEX IF NOT EXISTS source_idx   ON companies (source);
    CREATE INDEX IF NOT EXISTS status_idx   ON companies (status);
    CREATE INDEX IF NOT EXISTS inc_date_idx ON companies (inc_date);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uniq_reg_country'
      ) THEN
        ALTER TABLE companies ADD CONSTRAINT uniq_reg_country UNIQUE (reg_number, country);
      END IF;
    END $$;
  `);

  console.log("Tables created.");

  // Insert a demo API key
  const demoKey = `demo_${randomBytes(16).toString("hex")}`;
  await db.insert(apiKeys).values({
    id:        `key_${randomBytes(8).toString("hex")}`,
    key:       demoKey,
    label:     "Demo key — add to README for public testing",
    rateLimit: 20,
  }).onConflictDoNothing();

  console.log(`\nDemo API key created: ${demoKey}`);
  console.log("Add this to your README for public Cursor/Claude testing.\n");

  await pool.end();
  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
