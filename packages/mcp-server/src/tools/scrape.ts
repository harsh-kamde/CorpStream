import { v4 as uuid } from "uuid";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { companies, scrapeRuns, type NewCompany } from "../db/schema.js";
import { NormalizedCompany } from "../types.js";
import { fetchCHCompanies } from "../sources/companies-house.js";
import { fetchEDGARCompanies } from "../sources/sec-edgar.js";
import { triggerMCAScrape, fetchMCABulkDataset } from "../sources/mca-india.js";
import { fetchOpenCorporatesCompanies } from "../sources/opencorporates.js";
import { uploadCSVToS3 } from "../storage/s3.js";

export interface ScrapeArgs {
  source: "companies_house" | "sec_edgar" | "mca_india" | "opencorporates" | "all";
  daysBack?: number;
  limit?: number;
  country?: string;
  triggeredBy?: string;
}

export interface ScrapeResult {
  runId:        string;
  status:       "done" | "pending" | "failed";
  total:        number;
  sources:      string[];
  csvUrl?:      string;
  apifyRunId?:  string;
  sample:       Partial<NormalizedCompany>[];
  message:      string;
}

// ── Main scrape orchestrator ───────────────────────────────────────────────────
export async function scrapeSource(args: ScrapeArgs): Promise<ScrapeResult> {
  const { source, daysBack = 1, limit = 100, triggeredBy = "mcp" } = args;
  const runId = uuid();

  await db.insert(scrapeRuns).values({
    id:             runId,
    source,
    status:         "running",
    triggeredBy,
    daysBack,
    limitRequested: limit,
  });

  // MCA India is async (Apify run) — return pending immediately
  if (source === "mca_india") {
    try {
      const apify = await triggerMCAScrape(daysBack, limit);
      await db.update(scrapeRuns)
        .set({ apifyRunId: apify.runId, status: "pending" })
        .where(eq(scrapeRuns.id, runId));

      return {
        runId,
        status:      "pending",
        total:       0,
        sources:     ["mca_india"],
        apifyRunId:  apify.runId,
        sample:      [],
        message:
          `MCA India scrape started. Apify run ID: ${apify.runId}. ` +
          `Poll status with getScrapeStatus("${runId}")`,
      };
    } catch (err: any) {
      // Fallback to data.gov.in bulk dataset if Apify quota exhausted
      console.warn("[MCA] Apify failed, falling back to data.gov.in:", err.message);
      const bulk = await fetchMCABulkDataset();
      return saveBatch(runId, bulk, ["mca_india"], triggeredBy);
    }
  }

  // Synchronous sources
  const sourcesToRun =
    source === "all"
      ? (["companies_house", "sec_edgar", "opencorporates"] as const)
      : ([source] as const);

  const allCompanies: NormalizedCompany[] = [];
  const errors: string[] = [];

  for (const src of sourcesToRun) {
    try {
      let batch: NormalizedCompany[] = [];
      const perSourceLimit = Math.ceil(limit / sourcesToRun.length);

      if (src === "companies_house") {
        batch = await fetchCHCompanies(daysBack, perSourceLimit);
      } else if (src === "sec_edgar") {
        batch = await fetchEDGARCompanies(daysBack, perSourceLimit);
      } else if (src === "opencorporates") {
        batch = await fetchOpenCorporatesCompanies(daysBack, perSourceLimit);
      }

      allCompanies.push(...batch);
      console.log(`[Scrape] ${src}: ${batch.length} companies fetched`);
    } catch (err: any) {
      console.error(`[Scrape] ${src} failed:`, err.message);
      errors.push(`${src}: ${err.message}`);
    }
  }

  return saveBatch(runId, allCompanies, sourcesToRun as string[], triggeredBy, errors);
}

// ── Save batch to DB + S3, update run record ──────────────────────────────────
async function saveBatch(
  runId:       string,
  batch:       NormalizedCompany[],
  sources:     string[],
  triggeredBy: string,
  errors:      string[] = []
): Promise<ScrapeResult> {
  try {
    // Upsert — ignore duplicates, update scrapedAt on conflict
    if (batch.length > 0) {
      const rows: NewCompany[] = batch.map((c) => ({
        id:                 c.id,
        name:               c.name,
        registrationNumber: c.registrationNumber,
        country:            c.country,
        jurisdiction:       c.jurisdiction,
        incorporationDate:  c.incorporationDate,
        status:             c.status,
        companyType:        c.companyType,
        registeredAddress:  c.registeredAddress,
        directors:          c.directors,
        sic:                c.sic,
        source:             c.source,
        sourceUrl:          c.sourceUrl,
        scrapedAt:          new Date(),
        rawData:            c.rawData ?? null,
      }));

      // Batch insert in chunks of 100 to avoid query size limits
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        await db
          .insert(companies)
          .values(chunk)
          .onConflictDoUpdate({
            target: companies.id,
            set:    { scrapedAt: sql`now()` },
          });
      }
    }

    // Upload CSV export to S3
    const s3Key = await uploadCSVToS3(batch, runId);
    const csvUrl = s3Key
      ? `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-south-1"}.amazonaws.com/${s3Key}`
      : undefined;

    const finalStatus = errors.length === sources.length ? "failed" : "done";

    await db.update(scrapeRuns)
      .set({
        status:           finalStatus,
        companiesFetched: batch.length,
        s3CsvKey:         s3Key ?? undefined,
        completedAt:      new Date(),
        error:            errors.length > 0 ? errors.join("; ") : undefined,
      })
      .where(eq(scrapeRuns.id, runId));

    return {
      runId,
      status:  finalStatus,
      total:   batch.length,
      sources,
      csvUrl,
      sample:  batch.slice(0, 3).map(({ rawData: _raw, ...rest }) => rest),
      message: errors.length > 0
        ? `Completed with errors: ${errors.join("; ")}`
        : `Successfully scraped ${batch.length} companies from ${sources.join(", ")}`,
    };
  } catch (err: any) {
    await db.update(scrapeRuns)
      .set({ status: "failed", error: err.message, completedAt: new Date() })
      .where(eq(scrapeRuns.id, runId));
    throw err;
  }
}
