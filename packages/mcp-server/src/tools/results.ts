import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { scrapeRuns, companies, type NewCompany } from "../db/schema.js";
import { NormalizedCompany } from "../types.js";
import { uploadCSVToS3 } from "../storage/s3.js";
import { sql } from "drizzle-orm";

export interface ResultsArgs {
  runId?:   string;
  source?:  string;
  format?:  "json" | "csv_url" | "summary";
  limit?:   number;
}

export async function getResults(args: ResultsArgs) {
  const { runId, source, format = "summary", limit = 50 } = args;

  // Find the run
  let run: typeof scrapeRuns.$inferSelect | null = null;

  if (runId) {
    const [r] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId));
    if (!r) throw new Error(`Run not found: ${runId}`);
    run = r;
  } else if (source) {
    const [r] = await db.select().from(scrapeRuns)
      .where(eq(scrapeRuns.source, source))
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(1);
    run = r ?? null;
  }

  if (!run) throw new Error("Provide runId or source to get results");
  if (run.status === "failed") throw new Error(`Run failed: ${run.error}`);
  if (run.status === "pending") {
    return {
      status:  "pending",
      message: `Run still in progress. Use getScrapeStatus("${run.id}") to check.`,
    };
  }

  const csvUrl = run.s3CsvKey
    ? `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-south-1"}.amazonaws.com/${run.s3CsvKey}`
    : null;

  if (format === "csv_url") {
    return {
      runId:    run.id,
      source:   run.source,
      csvUrl,
      message:  csvUrl ?? "No CSV available for this run",
    };
  }

  // Fetch companies scraped in this run window (by scrapedAt timestamp)
  const rows = await db.select()
    .from(companies)
    .where(
      run.source !== "all"
        ? eq(companies.source, run.source)
        : sql`true`
    )
    .orderBy(desc(companies.scrapedAt))
    .limit(Math.min(limit, 200));

  const stripped = rows.map(({ rawData: _r, ...rest }) => rest);

  if (format === "summary") {
    // Group by country + source for summary stats
    const byCountry: Record<string, number> = {};
    const bySource:  Record<string, number> = {};
    for (const r of rows) {
      byCountry[r.country] = (byCountry[r.country] ?? 0) + 1;
      bySource[r.source]   = (bySource[r.source]   ?? 0) + 1;
    }

    return {
      runId:           run.id,
      source:          run.source,
      status:          run.status,
      totalFetched:    run.companiesFetched ?? 0,
      byCountry,
      bySource,
      csvUrl,
      sample:          stripped.slice(0, 5),
      completedAt:     run.completedAt?.toISOString() ?? null,
    };
  }

  // format === "json"
  return {
    runId:    run.id,
    source:   run.source,
    total:    rows.length,
    csvUrl,
    results:  stripped,
  };
}

// Called by runs.ts when Apify MCA run completes
export async function saveBatchFromRun(
  runId: string,
  batch: NormalizedCompany[],
  run:   typeof scrapeRuns.$inferSelect
): Promise<void> {
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

    for (let i = 0; i < rows.length; i += 100) {
      await db.insert(companies).values(rows.slice(i, i + 100))
        .onConflictDoUpdate({ target: companies.id, set: { scrapedAt: sql`now()` } });
    }
  }

  const s3Key = await uploadCSVToS3(batch, runId);

  await db.update(scrapeRuns)
    .set({
      status:           "done",
      companiesFetched: batch.length,
      s3CsvKey:         s3Key ?? undefined,
      completedAt:      new Date(),
    })
    .where(eq(scrapeRuns.id, runId));
}
