/**
 * Companies House (UK) adapter
 * Free API — register at: https://developer.company-information.service.gov.uk
 * Rate limit: 600 requests per 5 minutes
 * Gives: all new UK company registrations with full details
 */

import { NormalizedCompany, daysAgoISO, safeFetch } from "../types.js";

const BASE = "https://api.company-information.service.gov.uk";

function authHeader(): string {
  const key = process.env.CH_API_KEY;
  if (!key) throw new Error("CH_API_KEY env var not set");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function formatAddress(addr: Record<string, string> | undefined): string {
  if (!addr) return "";
  return [
    addr.address_line_1,
    addr.address_line_2,
    addr.locality,
    addr.region,
    addr.postal_code,
    addr.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export async function fetchCHCompanies(
  daysBack: number,
  limit: number
): Promise<NormalizedCompany[]> {
  const fromDate = daysAgoISO(daysBack);
  const results: NormalizedCompany[] = [];
  let startIndex = 0;
  const pageSize = 100;

  // CH returns max 100 per page — paginate up to limit
  while (results.length < limit) {
    const url =
      `${BASE}/advanced-search/companies` +
      `?incorporated_from=${fromDate}` +
      `&size=${Math.min(pageSize, limit - results.length)}` +
      `&start_index=${startIndex}`;

    const res = await safeFetch(url, {
      headers: { Authorization: authHeader() },
    });

    if (res.status === 429) {
      // Rate limited — wait 6 seconds and retry once
      await new Promise((r) => setTimeout(r, 6_000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Companies House API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const items: any[] = data.items ?? [];
    if (items.length === 0) break;

    for (const c of items) {
      results.push({
        id:                 `ch:${c.company_number}`,
        name:               c.company_name ?? "Unknown",
        registrationNumber: c.company_number,
        country:            "GB",
        jurisdiction:       c.registered_office_address?.region ?? "",
        incorporationDate:  c.date_of_creation ?? "",
        status:             c.company_status === "active" ? "active" : "dissolved",
        companyType:        c.company_type ?? "",
        registeredAddress:  formatAddress(c.registered_office_address),
        directors:          [],  // Requires a second API call per company — skip for bulk
        sic:                c.sic_codes ?? [],
        source:             "companies_house",
        sourceUrl:
          `https://find-and-update.company-information.service.gov.uk/company/${c.company_number}`,
        scrapedAt:          new Date().toISOString(),
        rawData:            c,
      });
    }

    startIndex += items.length;
    if (items.length < pageSize) break; // No more pages
  }

  return results.slice(0, limit);
}

// Enrich a single company with director info (call sparingly — uses quota)
export async function fetchCHDirectors(companyNumber: string): Promise<string[]> {
  const res = await safeFetch(
    `${BASE}/company/${companyNumber}/officers?items_per_page=10`,
    { headers: { Authorization: authHeader() } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items ?? [])
    .filter((o: any) => o.officer_role === "director" && !o.resigned_on)
    .map((o: any) => o.name as string);
}
