#!/usr/bin/env tsx
/**
 * scripts/test-tools.ts
 * Quick end-to-end test of all MCP tools.
 * Run from local machine pointing at EC2 or locally with a .env file.
 *
 * Usage:
 *   MCP_URL=http://YOUR_EC2_IP:3000 API_KEY=your_key npx tsx scripts/test-tools.ts
 */

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000";
const API_KEY  = process.env.API_KEY ?? "";

async function callTool(name: string, args: object) {
  const res = await fetch(`${MCP_URL}/mcp`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key":    API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id:      1,
      method:  "tools/call",
      params:  { name, arguments: args },
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return JSON.parse(data.result.content[0].text);
}

async function runTests() {
  console.log(`Testing MCP server at ${MCP_URL}\n`);

  // ── Test 1: Health check ─────────────────────────────────────────────────
  console.log("Test 1: Health check");
  const health = await fetch(`${MCP_URL}/health`);
  const healthData = await health.json();
  console.log("  Status:", healthData.status, "| Uptime:", healthData.uptime, "s\n");

  // ── Test 2: List tools via MCP ───────────────────────────────────────────
  console.log("Test 2: List MCP tools");
  const listRes = await fetch(`${MCP_URL}/mcp`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const listData = await listRes.json();
  const tools = listData.result?.tools ?? [];
  console.log("  Tools available:", tools.map((t: any) => t.name).join(", "), "\n");

  // ── Test 3: Scrape Companies House (UK) ─────────────────────────────────
  console.log("Test 3: Scrape Companies House (daysBack=1, limit=5)");
  try {
    const scrape = await callTool("scrapeCompanies", {
      source: "companies_house",
      daysBack: 1,
      limit: 5,
    });
    console.log("  Status:", scrape.status);
    console.log("  Companies fetched:", scrape.total);
    console.log("  Run ID:", scrape.runId);
    if (scrape.sample?.[0]) {
      console.log("  Sample:", scrape.sample[0].name, `(${scrape.sample[0].country})`);
    }
  } catch (err: any) {
    console.log("  FAILED:", err.message);
  }
  console.log();

  // ── Test 4: Search companies ─────────────────────────────────────────────
  console.log("Test 4: Search companies (country=GB, status=active)");
  try {
    const search = await callTool("searchCompanies", {
      country: "GB",
      status:  "active",
      limit:   5,
    });
    console.log("  Total in DB:", search.total);
    console.log("  Returned:", search.results.length);
    if (search.results?.[0]) {
      console.log("  Sample:", search.results[0].name);
    }
  } catch (err: any) {
    console.log("  FAILED:", err.message);
  }
  console.log();

  // ── Test 5: List runs ────────────────────────────────────────────────────
  console.log("Test 5: List runs");
  try {
    const runs = await callTool("listRuns", { limit: 3 });
    console.log("  Recent runs:", runs.length);
    if (runs[0]) {
      console.log("  Latest:", runs[0].source, "-", runs[0].status, `(${runs[0].companiesFetched} companies)`);
    }
  } catch (err: any) {
    console.log("  FAILED:", err.message);
  }

  console.log("\nAll tests complete.");
}

runTests().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
