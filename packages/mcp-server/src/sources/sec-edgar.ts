/**
 * SEC EDGAR (USA) adapter
 * Completely free — no API key required
 * Only requires: User-Agent header with your email (SEC policy)
 * https://www.sec.gov/developer
 * Gives: US companies filing S-1 (IPO), 10-K (annual report), 8-K (events)
 */

import { NormalizedCompany, daysAgoISO, safeFetch } from "../types.js";

const EFTS_BASE = "https://efts.sec.gov/LATEST/search-index";
const DATA_BASE = "https://data.sec.gov";

function userAgent(): string {
  const email = process.env.CONTACT_EMAIL ?? "dev@example.com";
  return `global-company-mcp/1.0 (${email})`;
}

// Map SEC form types to readable company types
const FORM_TYPE_MAP: Record<string, string> = {
  "S-1":    "IPO_registration",
  "10-K":   "annual_report_filer",
  "8-K":    "event_filer",
  "10-12G": "general_registration",
  "20-F":   "foreign_private_issuer",
};

export async function fetchEDGARCompanies(
  daysBack: number,
  limit: number
): Promise<NormalizedCompany[]> {
  const fromDate = daysAgoISO(daysBack);
  const results: NormalizedCompany[] = [];

  // Fetch multiple form types for better coverage
  const formTypes = ["S-1", "10-12G", "20-F"];

  for (const form of formTypes) {
    if (results.length >= limit) break;

    const url =
      `${EFTS_BASE}` +
      `?q=%22${encodeURIComponent(form)}%22` +
      `&dateRange=custom&startdt=${fromDate}` +
      `&forms=${form}` +
      `&hits.hits.total.value=true` +
      `&hits.hits._source=entity_name,file_date,inc_states,entity_id,file_num,period_of_report`;

    const res = await safeFetch(url, {
      headers: { "User-Agent": userAgent() },
    });

    if (!res.ok) {
      console.warn(`[EDGAR] ${form} search returned ${res.status}`);
      continue;
    }

    const data = await res.json();
    const hits: any[] = data?.hits?.hits ?? [];

    for (const h of hits) {
      if (results.length >= limit) break;
      const s = h._source ?? {};

      // Skip if we already have this entity
      const id = `edgar:${s.entity_id}`;
      if (results.find((r) => r.id === id)) continue;

      results.push({
        id,
        name:               s.entity_name ?? "Unknown",
        registrationNumber: String(s.entity_id ?? ""),
        country:            "US",
        jurisdiction:       Array.isArray(s.inc_states) ? s.inc_states[0] : "",
        incorporationDate:  s.file_date ?? "",
        status:             "active",
        companyType:        FORM_TYPE_MAP[form] ?? form,
        registeredAddress:  "",
        directors:          [],
        sic:                [],
        source:             "sec_edgar",
        sourceUrl:
          `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${s.entity_id}&type=${form}`,
        scrapedAt:          new Date().toISOString(),
        rawData:            s,
      });
    }

    // EDGAR recommends max 10 req/sec — small delay between form types
    await new Promise((r) => setTimeout(r, 200));
  }

  return results;
}

// Fetch full company facts from EDGAR (richer data, but slower)
export async function fetchEDGARCompanyFacts(cik: string): Promise<Record<string, unknown>> {
  const paddedCik = String(cik).padStart(10, "0");
  const res = await safeFetch(
    `${DATA_BASE}/submissions/CIK${paddedCik}.json`,
    { headers: { "User-Agent": userAgent() } }
  );
  if (!res.ok) return {};
  return res.json();
}
