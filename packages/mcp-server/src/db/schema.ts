import {
  pgTable, text, timestamp, jsonb, integer,
  index, unique, boolean,
} from "drizzle-orm/pg-core";

// ── Canonical company record ──────────────────────────────────────────────────
export const companies = pgTable(
  "companies",
  {
    id:                 text("id").primaryKey(),          // "ch:12345678"
    name:               text("name").notNull(),
    registrationNumber: text("reg_number").notNull(),
    country:            text("country").notNull(),        // ISO 3166-1 alpha-2
    jurisdiction:       text("jurisdiction").default(""),
    incorporationDate:  text("inc_date").default(""),
    status:             text("status").notNull().default("active"),
    companyType:        text("company_type").default(""),
    registeredAddress:  text("reg_address").default(""),
    directors:          text("directors").array().default([]),
    sic:                text("sic").array().default([]),  // industry codes
    source:             text("source").notNull(),
    sourceUrl:          text("source_url").default(""),
    scrapedAt:          timestamp("scraped_at").defaultNow(),
    rawData:            jsonb("raw_data"),
  },
  (t) => ({
    countryIdx:  index("country_idx").on(t.country),
    sourceIdx:   index("source_idx").on(t.source),
    statusIdx:   index("status_idx").on(t.status),
    incDateIdx:  index("inc_date_idx").on(t.incorporationDate),
    uniqReg:     unique("uniq_reg_country").on(t.registrationNumber, t.country),
  })
);

// ── Scrape run audit log ──────────────────────────────────────────────────────
export const scrapeRuns = pgTable("scrape_runs", {
  id:                text("id").primaryKey(),             // uuid
  source:            text("source").notNull(),
  status:            text("status").notNull().default("pending"),
  triggeredBy:       text("triggered_by").default("manual"),
  companiesFetched:  integer("companies_fetched").default(0),
  apifyRunId:        text("apify_run_id"),
  s3CsvKey:          text("s3_csv_key"),
  daysBack:          integer("days_back").default(1),
  limitRequested:    integer("limit_requested").default(100),
  startedAt:         timestamp("started_at").defaultNow(),
  completedAt:       timestamp("completed_at"),
  error:             text("error"),
});

// ── API keys table (for public demo access control) ───────────────────────────
export const apiKeys = pgTable("api_keys", {
  id:          text("id").primaryKey(),
  key:         text("key").notNull().unique(),
  label:       text("label").default(""),
  isActive:    boolean("is_active").default(true),
  rateLimit:   integer("rate_limit").default(100),        // req per hour
  createdAt:   timestamp("created_at").defaultNow(),
  lastUsedAt:  timestamp("last_used_at"),
});

// ── Types inferred from schema ────────────────────────────────────────────────
export type Company      = typeof companies.$inferSelect;
export type NewCompany   = typeof companies.$inferInsert;
export type ScrapeRun    = typeof scrapeRuns.$inferSelect;
export type NewScrapeRun = typeof scrapeRuns.$inferInsert;
