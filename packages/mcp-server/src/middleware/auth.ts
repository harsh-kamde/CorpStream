import type { IncomingMessage, ServerResponse } from "http";

export type NextFn = () => void;

// ── Primary API key auth (for MCP endpoint) ───────────────────────────────────
export function apiKeyAuth(
  req: IncomingMessage,
  res: ServerResponse,
  next: NextFn
): void {
  const key = req.headers["x-api-key"];
  const validKey = process.env.API_KEY;

  if (!validKey) {
    console.error("[Auth] API_KEY env var not set — rejecting all requests");
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Server misconfigured" }));
    return;
  }

  if (!key || key !== validKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized — provide x-api-key header" }));
    return;
  }

  next();
}

// ── Internal Lambda-to-server key (separate from public API key) ──────────────
export function internalKeyAuth(
  req: IncomingMessage,
  res: ServerResponse,
  next: NextFn
): void {
  const key = req.headers["x-internal-key"];
  const validKey = process.env.INTERNAL_KEY;

  if (!validKey || !key || key !== validKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  next();
}

// ── Read body from request stream ─────────────────────────────────────────────
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end",  () => resolve(body));
    req.on("error", reject);
  });
}
