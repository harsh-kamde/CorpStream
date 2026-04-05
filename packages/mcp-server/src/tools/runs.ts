import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { scrapeRuns } from "../db/schema.js";
import { pollMCARun } from "../sources/mca-india.js";
import { uploadCSVToS3 } from "../storage/s3.js";
import { fetchMCABulkDataset } from "../sources/mca-india.js";
import { saveBatchFromRun } from "./results.js";

export async function getRunStatus(runId: string) {
  const [run] = await db
    .select()
    .from(scrapeRuns)
    .where(eq(scrapeRuns.id, runId));

  if (!run) throw new Error(`Run not found: ${runId}`);

  // If MCA run is still pending, poll Apify for update
  if (run.status === "pending" && run.apifyRunId) {
    try {
      const apifyStatus = await pollMCARun(run.apifyRunId);

      if (apifyStatus.ready && apifyStatus.companies) {
        // Apify run finished — save results now
        await saveBatchFromRun(runId, apifyStatus.companies, run);
        const [updated] = await db.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId));
        return formatRun(updated);
      }

      return {
        ...formatRun(run),
        apifyStatus: apifyStatus.status,
        message: `Apify run still ${apifyStatus.status}. Check back in a minute.`,
      };
    } catch (err: any) {
      return {
        ...formatRun(run),
        apifyError: err.message,
      };
    }
  }

  return formatRun(run);
}

export async function listRuns(limit: number) {
  const runs = await db
    .select()
    .from(scrapeRuns)
    .orderBy(desc(scrapeRuns.startedAt))
    .limit(Math.min(limit, 50));

  return runs.map(formatRun);
}

function formatRun(run: typeof scrapeRuns.$inferSelect) {
  return {
    runId:           run.id,
    source:          run.source,
    status:          run.status,
    triggeredBy:     run.triggeredBy,
    companiesFetched: run.companiesFetched ?? 0,
    apifyRunId:      run.apifyRunId ?? null,
    csvAvailable:    !!run.s3CsvKey,
    startedAt:       run.startedAt?.toISOString() ?? null,
    completedAt:     run.completedAt?.toISOString() ?? null,
    durationSeconds: run.completedAt && run.startedAt
      ? Math.round((run.completedAt.getTime() - run.startedAt.getTime()) / 1000)
      : null,
    error:           run.error ?? null,
  };
}
