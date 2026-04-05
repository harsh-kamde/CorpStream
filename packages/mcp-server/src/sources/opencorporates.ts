/**
 * OpenCorporates adapter
 * Free tier: 500 API calls/day (no key needed for basic search)
 * With free API key: higher limits + more fields
 * Register: https://opencorporates.com/api_accounts/new
 * Covers: 140+ jurisdictions worldwide
 */

import { NormalizedCompany, daysAgoISO, safeFetch } from "../types.js";

const BASE = "https://api.opencorporates.com/v0.4";

// Map OpenCorporates jurisdiction codes to ISO country codes
const JURISDICTION_COUNTRY: Record<string, string> = {
  "us_de": "US", "us_ca": "US", "us_ny": "US", "us_tx": "US",
  "gb":    "GB", "ie":    "IE", "au":    "AU", "ca_on": "CA",
  "in":    "IN", "sg":    "SG", "hk":    "HK", "nz":    "NZ",
  "de":    "DE", "fr":    "FR", "nl":    "NL", "ch":    "CH",
};

function extractCountry(jurisdiction: string): string {
  if (!jurisdiction) return "XX";
  const lower = jurisdiction.toLowerCase();
  // Direct 2-letter match
  if (lower.length === 2) return lower.toUpperCase();
  // Jurisdiction prefix match
  for (const [key, val] of Object.entries(JURISDICTION_COUNTRY)) {
    if (lower.startsWith(key)) return val;
  }
  return lower.split("_")[0].toUpperCase();
}

export async function fetchOpenCorporatesCompanies(
  daysBack: number,
  limit: number,
  jurisdictionCode?: string
): Promise<NormalizedCompany[]> {
  const fromDate = daysAgoISO(daysBack);
  const apiKey   = process.env.OPENCORP_API_KEY;
  const results: NormalizedCompany[] = [];

  // Build query — search by incorporation date
  let url =
    `${BASE}/companies/search` +
    `?incorporation_date=${fromDate}:` +  // "from:date" range syntax
    `&per_page=${Math.min(limit, 100)}` +
    `&order=incorporation_date`;

  if (jurisdictionCode) url += `&jurisdiction_code=${jurisdictionCode}`;
  if (apiKey)           url += `&api_token=${apiKey}`;

  const res = await safeFetch(url);

  if (res.status === 429) {
    throw new Error("OpenCorporates rate limit reached. Free tier: 500 req/day.");
  }
  if (!res.ok) {
    console.warn(`[OpenCorporates] ${res.status} — skipping`);
    return [];
  }

  const data = await res.json();
  const companies: any[] = data?.results?.companies ?? [];

  for (const { company: c } of companies) {
    if (results.length >= limit) break;
    results.push({
      id:                 `oc:${c.jurisdiction_code}:${c.company_number}`,
      name:               c.name ?? "Unknown",
      registrationNumber: c.company_number ?? "",
      country:            extractCountry(c.jurisdiction_code ?? ""),
      jurisdiction:       c.jurisdiction_code ?? "",
      incorporationDate:  c.incorporation_date ?? "",
      status:             c.current_status?.toLowerCase().includes("active")
                          ? "active"
                          : c.current_status
                          ? "dissolved"
                          : "unknown",
      companyType:        c.company_type ?? "",
      registeredAddress:  c.registered_address_in_full ?? "",
      directors:          [],
      sic:                [],
      source:             "opencorporates",
      sourceUrl:          c.opencorporates_url ?? "",
      scrapedAt:          new Date().toISOString(),
      rawData:            c,
    });
  }

  return results;
}
