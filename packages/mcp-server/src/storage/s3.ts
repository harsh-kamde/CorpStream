import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { stringify } from "csv-stringify/sync";
import { NormalizedCompany } from "../types.js";

const s3 = new S3Client({
  region: process.env.AWS_REGION ?? "ap-south-1",
  // Credentials auto-resolved from EC2 IAM role — no keys in code
});

const BUCKET = process.env.S3_BUCKET ?? "";

// CSV columns in preferred order
const CSV_COLUMNS = [
  "id", "name", "registrationNumber", "country", "jurisdiction",
  "incorporationDate", "status", "companyType", "registeredAddress",
  "source", "sourceUrl", "scrapedAt",
];

// ── Upload CSV and return S3 key ───────────────────────────────────────────────
export async function uploadCSVToS3(
  companies: NormalizedCompany[],
  runId: string
): Promise<string | null> {
  if (!BUCKET || companies.length === 0) return null;

  const date = new Date().toISOString().split("T")[0];
  const key  = `exports/${date}/${runId}.csv`;

  const csv = stringify(
    companies.map((c) => ({
      ...c,
      directors: c.directors.join(" | "),
      sic:       c.sic.join(" | "),
    })),
    { header: true, columns: CSV_COLUMNS }
  );

  await s3.send(
    new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        csv,
      ContentType: "text/csv",
      Metadata: {
        runId,
        companyCount: String(companies.length),
        sources:      [...new Set(companies.map((c) => c.source))].join(","),
      },
    })
  );

  return key;
}

// ── Upload raw JSON snapshot (for debugging/re-processing) ────────────────────
export async function uploadRawJSON(
  data: unknown,
  source: string,
  runId: string
): Promise<string | null> {
  if (!BUCKET) return null;

  const date = new Date().toISOString().split("T")[0];
  const key  = `raw/${date}/${source}_${runId}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        JSON.stringify(data, null, 2),
      ContentType: "application/json",
    })
  );

  return key;
}

// ── Generate a 1-hour pre-signed download URL ─────────────────────────────────
export async function getDownloadUrl(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

export function buildPublicUrl(s3Key: string): string {
  return `https://${BUCKET}.s3.${process.env.AWS_REGION ?? "ap-south-1"}.amazonaws.com/${s3Key}`;
}
