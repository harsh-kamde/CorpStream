/**
 * MCA India (Ministry of Corporate Affairs) adapter
 * Uses Apify free tier (5 compute units/month) to scrape MCA21 portal
 * MCA has no public API — scraping is the only option
 * Portal: https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do
 *
 * Free alternatives for MCA data:
 *   - data.gov.in bulk datasets (monthly, not daily)
 *   - MCA21 public search (requires Apify actor)
 */

import { NormalizedCompany, daysAgoISO, safeFetch } from "../types.js";

const APIFY_BASE = "https://api.apify.com/v2";

function apifyToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN env var not set");
  return token;
}

function mcaActorId(): string {
  const id = process.env.MCA_ACTOR_ID;
  if (!id) throw new Error("MCA_ACTOR_ID env var not set");
  return id;
}

// ── Trigger a new MCA scrape run (async — poll with pollMCArun) ────────────────
export async function triggerMCAScrape(
  daysBack: number,
  limit: number
): Promise<{ runId: string; status: string; source: "mca_india" }> {
  const res = await safeFetch(
    `${APIFY_BASE}/acts/${mcaActorId()}/runs?token=${apifyToken()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate:   daysAgoISO(daysBack),
        endDate:     daysAgoISO(0),
        maxResults:  limit,
        proxyConfig: { useApifyProxy: true }, // Free Apify proxy included
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify trigger failed ${res.status}: ${body}`);
  }

  const { data } = await res.json();
  return { runId: data.id, status: data.status, source: "mca_india" };
}

// ── Poll run status ────────────────────────────────────────────────────────────
export async function pollMCARun(runId: string): Promise<{
  ready: boolean;
  status: string;
  companies?: NormalizedCompany[];
}> {
  const res = await safeFetch(
    `${APIFY_BASE}/actor-runs/${runId}?token=${apifyToken()}`
  );
  const { data } = await res.json();

  if (data.status === "FAILED" || data.status === "ABORTED") {
    throw new Error(`MCA Apify run ${runId} ended with status: ${data.status}`);
  }

  if (data.status !== "SUCCEEDED") {
    return { ready: false, status: data.status };
  }

  // Run succeeded — fetch dataset
  const dataRes = await safeFetch(
    `${APIFY_BASE}/datasets/${data.defaultDatasetId}/items?token=${apifyToken()}&clean=true`
  );
  const items: any[] = await dataRes.json();

  return {
    ready: true,
    status: "SUCCEEDED",
    companies: items.map(normalizeMCARecord),
  };
}

// ── Normalize raw MCA record to canonical shape ────────────────────────────────
function normalizeMCARecord(c: any): NormalizedCompany {
  const cin = c.cin ?? c.CIN ?? "";
  const status = (c.companyStatus ?? c.status ?? "").toLowerCase();

  return {
    id:                 `mca:${cin}`,
    name:               c.companyName ?? c.company_name ?? "Unknown",
    registrationNumber: cin,
    country:            "IN",
    jurisdiction:       c.state ?? c.registeredState ?? "",
    incorporationDate:  formatMCADate(c.dateOfIncorporation ?? c.date_of_incorporation),
    status:             status.includes("active") ? "active"
                      : status.includes("dissolved") ? "dissolved"
                      : "unknown",
    companyType:        c.companyClass ?? c.company_class ?? "",
    registeredAddress:  c.registeredAddress ?? c.registered_address ?? "",
    directors:          [],
    sic:                c.nicCode ? [c.nicCode] : [],
    source:             "mca_india",
    sourceUrl:
      `https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do?cin=${encodeURIComponent(cin)}`,
    scrapedAt:          new Date().toISOString(),
    rawData:            c,
  };
}

// MCA dates come as "01/04/2024" or "2024-04-01"
function formatMCADate(raw: string | undefined): string {
  if (!raw) return "";
  if (raw.includes("/")) {
    const [d, m, y] = raw.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return raw;
}

// ── Data.gov.in bulk dataset (free, monthly refresh) ──────────────────────────
// Use as fallback when Apify quota is exhausted
export async function fetchMCABulkDataset(): Promise<NormalizedCompany[]> {
  // data.gov.in API — MCA company master dataset
  // Resource ID: 8f0e5fc4-b036-41db-a0b8-ee13c9ede5f6
  const apiKey = process.env.DATA_GOV_API_KEY ?? "579b464db66ec23bdd000001cdd3946e44ce4aab825d70c01ca5";

  const res = await safeFetch(
    `https://api.data.gov.in/resource/8f0e5fc4-b036-41db-a0b8-ee13c9ede5f6` +
    `?api-key=${apiKey}&format=json&limit=100&filters[COMPANY_STATUS]=Active`
  );

  if (!res.ok) return [];
  const { records = [] } = await res.json();

  return records.map((c: any): NormalizedCompany => ({
    id:                 `mca:${c.CIN}`,
    name:               c.COMPANY_NAME ?? "Unknown",
    registrationNumber: c.CIN,
    country:            "IN",
    jurisdiction:       c.REGISTRAR_OF_COMPANIES ?? "",
    incorporationDate:  formatMCADate(c.DATE_OF_INCORPORATION),
    status:             "active",
    companyType:        c.COMPANY_CLASS ?? "",
    registeredAddress:  "",
    directors:          [],
    sic:                [],
    source:             "mca_india",
    sourceUrl:
      `https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do?cin=${encodeURIComponent(c.CIN)}`,
    scrapedAt:          new Date().toISOString(),
    rawData:            c,
  }));
}
