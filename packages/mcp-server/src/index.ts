import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "http";
import { scrapeSource } from "./tools/scrape.js";
import { searchCompanies } from "./tools/search.js";
import { getRunStatus, listRuns } from "./tools/runs.js";
import { getResults } from "./tools/results.js";
import { apiKeyAuth, internalKeyAuth, readBody } from "./middleware/auth.js";
import { closeDb } from "./db/client.js";

// ── MCP Server ─────────────────────────────────────────────────────────────────
const server = new McpServer({
  name:        "global-company-mcp",
  version:     "1.0.0",
  description: "Aggregate freshly registered companies from Companies House UK, SEC EDGAR USA, MCA India, and OpenCorporates.",
});

// ── Tool 1: Scrape companies ───────────────────────────────────────────────────
server.tool(
  "scrapeCompanies",
  "Trigger a scrape of newly registered companies from one or all sources. " +
  "For MCA India (Apify), returns immediately with a runId — poll with getScrapeStatus.",
  {
    source: z
      .enum(["companies_house", "sec_edgar", "mca_india", "opencorporates", "all"])
      .describe("Which registry to scrape. 'all' runs CH + EDGAR + OpenCorporates together."),
    daysBack: z
      .number().int().min(1).max(7).default(1)
      .describe("How many days back to look for new registrations."),
    limit: z
      .number().int().min(1).max(500).default(100)
      .describe("Max number of companies to fetch."),
  },
  async (args) => {
    try {
      const result = await scrapeSource({ ...args, triggeredBy: "mcp" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 2: Search stored companies ───────────────────────────────────────────
server.tool(
  "searchCompanies",
  "Search the local database of scraped companies. Filter by name, country, date range, status, or source.",
  {
    query: z
      .string().optional()
      .describe("Company name or registration number (partial match supported)."),
    country: z
      .string().length(2).optional()
      .describe("Filter by ISO2 country code: GB, US, IN, etc."),
    source: z
      .enum(["companies_house", "sec_edgar", "mca_india", "opencorporates"]).optional()
      .describe("Filter by data source."),
    status: z
      .enum(["active", "dissolved", "all"]).default("active")
      .describe("Filter by company status."),
    registeredAfter: z
      .string().optional()
      .describe("ISO date filter: only companies registered after this date. Format: YYYY-MM-DD"),
    registeredBefore: z
      .string().optional()
      .describe("ISO date filter: only companies registered before this date."),
    companyType: z
      .string().optional()
      .describe("Filter by company type, e.g. 'private-limited', 'llp'."),
    limit: z
      .number().int().min(1).max(100).default(20)
      .describe("Number of results to return."),
    offset: z
      .number().int().min(0).default(0)
      .describe("Pagination offset."),
  },
  async (args) => {
    try {
      const result = await searchCompanies(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 3: Get scrape run status ──────────────────────────────────────────────
server.tool(
  "getScrapeStatus",
  "Check the status of a scrape run. For MCA India runs, this also polls Apify and saves results if ready.",
  {
    runId: z.string().describe("The runId returned by scrapeCompanies."),
  },
  async ({ runId }) => {
    try {
      const status = await getRunStatus(runId);
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 4: Get results from a run ────────────────────────────────────────────
server.tool(
  "getResults",
  "Fetch the output of a completed scrape run. Returns companies with optional CSV download URL.",
  {
    runId: z
      .string().optional()
      .describe("Run ID. If omitted, returns results from the latest run for 'source'."),
    source: z
      .enum(["companies_house", "sec_edgar", "mca_india", "opencorporates"]).optional()
      .describe("Used to find the latest run if runId is not provided."),
    format: z
      .enum(["json", "csv_url", "summary"]).default("summary")
      .describe("summary = stats + 5 sample records. json = full list. csv_url = S3 download link only."),
    limit: z
      .number().int().min(1).max(200).default(50)
      .describe("Max companies to return in json format."),
  },
  async (args) => {
    try {
      const result = await getResults(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── Tool 5: List recent runs ───────────────────────────────────────────────────
server.tool(
  "listRuns",
  "List recent scrape runs with their status, duration, and company count. Useful for auditing.",
  {
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ limit }) => {
    try {
      const runs = await listRuns(limit);
      return { content: [{ type: "text", text: JSON.stringify(runs, null, 2) }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ── HTTP server ────────────────────────────────────────────────────────────────
const transport = new StreamableHTTPServerTransport({ path: "/mcp" });

const httpServer = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  // ── /health — unauthenticated (AWS target group health checks) ────────────
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200);
    res.end(JSON.stringify({
      status:  "ok",
      version: "1.0.0",
      uptime:  Math.round(process.uptime()),
    }));
    return;
  }

  // ── /internal/scrape — Lambda to MCP internal trigger ─────────────────────
  if (req.url === "/internal/scrape" && req.method === "POST") {
    internalKeyAuth(req, res, async () => {
      try {
        const body = await readBody(req);
        const args = JSON.parse(body);
        const result = await scrapeSource({ ...args, triggeredBy: "lambda" });
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── /mcp — authenticated MCP endpoint ────────────────────────────────────
  if (req.url?.startsWith("/mcp")) {
    apiKeyAuth(req, res, () => {
      transport.handleRequest(req, res);
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.connect(transport);

const PORT = Number(process.env.PORT ?? 3000);
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[MCP] Global Company MCP server running on :${PORT}`);
  console.log(`[MCP] Endpoints: /health  /mcp  /internal/scrape`);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown() {
  console.log("[MCP] Shutting down...");
  httpServer.close();
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
