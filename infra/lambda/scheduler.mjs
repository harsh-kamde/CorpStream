/**
 * AWS Lambda — scheduled scrape trigger
 * Invoked daily by EventBridge cron (free forever)
 * Calls the MCP server's /internal/scrape endpoint
 */

const MCP_URL = `http://${process.env.EC2_PRIVATE_IP}:3000/internal/scrape`;
const INTERNAL_KEY = process.env.INTERNAL_KEY ?? "";

const DAILY_SOURCES = [
  { source: "companies_house", daysBack: 1, limit: 300 },
  { source: "sec_edgar",       daysBack: 1, limit: 200 },
  { source: "opencorporates",  daysBack: 1, limit: 100 },
];

export const handler = async (event) => {
  console.log("[Lambda] Daily scrape triggered", new Date().toISOString());

  const results = [];

  for (const job of DAILY_SOURCES) {
    try {
      const res = await fetch(MCP_URL, {
        method:  "POST",
        headers: {
          "Content-Type":    "application/json",
          "x-internal-key":  INTERNAL_KEY,
        },
        body: JSON.stringify(job),
      });

      if (!res.ok) {
        const text = await res.text();
        results.push({ source: job.source, status: "error", error: text });
        console.error(`[Lambda] ${job.source} failed: ${res.status} ${text}`);
        continue;
      }

      const data = await res.json();
      results.push({ source: job.source, status: "ok", runId: data.runId, total: data.total });
      console.log(`[Lambda] ${job.source}: ${data.total} companies, runId=${data.runId}`);

      // Small delay between sources to avoid overwhelming EC2
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      results.push({ source: job.source, status: "error", error: err.message });
      console.error(`[Lambda] ${job.source} threw:`, err.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ triggered: new Date().toISOString(), results }),
  };
};
