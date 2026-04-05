import { db } from "../db/client.js";
import { companies } from "../db/schema.js";
import {
  ilike, eq, and, gte, lte, or, desc, sql, type SQL
} from "drizzle-orm";

export interface SearchArgs {
  query?:           string;   // name or reg number
  country?:         string;   // ISO2
  source?:          string;
  status?:          "active" | "dissolved" | "all";
  registeredAfter?: string;   // "YYYY-MM-DD"
  registeredBefore?: string;
  companyType?:     string;
  limit?:           number;
  offset?:          number;
}

export interface SearchResult {
  total:    number;
  results:  ReturnType<typeof stripRaw>[];
  page:     number;
  pageSize: number;
}

export async function searchCompanies(args: SearchArgs): Promise<SearchResult> {
  const {
    query, country, source, status = "active",
    registeredAfter, registeredBefore, companyType,
    limit = 20, offset = 0,
  } = args;

  const conditions: SQL[] = [];

  // Full-text name search (case-insensitive LIKE)
  if (query) {
    conditions.push(
      or(
        ilike(companies.name, `%${query}%`),
        ilike(companies.registrationNumber, `%${query}%`)
      )!
    );
  }

  if (country)      conditions.push(eq(companies.country, country.toUpperCase()));
  if (source)       conditions.push(eq(companies.source, source));
  if (companyType)  conditions.push(ilike(companies.companyType, `%${companyType}%`));

  if (status !== "all") {
    conditions.push(eq(companies.status, status));
  }

  if (registeredAfter) {
    conditions.push(gte(companies.incorporationDate, registeredAfter));
  }
  if (registeredBefore) {
    conditions.push(lte(companies.incorporationDate, registeredBefore));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total matching rows
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .where(where);

  // Fetch page
  const rows = await db
    .select()
    .from(companies)
    .where(where)
    .orderBy(desc(companies.incorporationDate))
    .limit(Math.min(limit, 100))
    .offset(offset);

  return {
    total:    count,
    results:  rows.map(stripRaw),
    page:     Math.floor(offset / limit) + 1,
    pageSize: limit,
  };
}

// Strip rawData from API responses (keep DB clean, responses small)
function stripRaw(row: typeof companies.$inferSelect) {
  const { rawData: _raw, ...rest } = row;
  return rest;
}
