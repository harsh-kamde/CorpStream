// ── Canonical shape every source adapter must produce ────────────────────────
export interface NormalizedCompany {
  id:                 string;   // "ch:12345678" | "edgar:0001234567" | "mca:U12345MH2024"
  name:               string;
  registrationNumber: string;
  country:            string;   // ISO 3166-1 alpha-2
  jurisdiction:       string;   // state / county / region
  incorporationDate:  string;   // "YYYY-MM-DD"
  status:             "active" | "dissolved" | "dormant" | "unknown";
  companyType:        string;
  registeredAddress:  string;
  directors:          string[];
  sic:                string[];
  source:             SourceId;
  sourceUrl:          string;
  scrapedAt:          string;   // ISO 8601
  rawData?:           unknown;
}

export type SourceId =
  | "companies_house"
  | "sec_edgar"
  | "mca_india"
  | "opencorporates";

// ── Date helpers ──────────────────────────────────────────────────────────────
export function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().split("T")[0];
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Safe fetch with timeout ───────────────────────────────────────────────────
export async function safeFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Chunk array helper ────────────────────────────────────────────────────────
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
