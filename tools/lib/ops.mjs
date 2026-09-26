// Every pass the Mothership makes, from any terminal, tells the crew server what it did.
//
// The live board shows only what the server knows. A nightly run and a Florida sweep from a laptop are
// the same machine to a viewer: EarthPilot's own automated reading. So any tool that reads, classifies
// or merges reports its pass here, and the board flies the Mothership to the state it worked.
// Silent when no maintainer token is available; never blocks or fails the tool that calls it.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function token() {
  if (process.env.ESCP_MAINTAINER_TOKEN) return process.env.ESCP_MAINTAINER_TOKEN;
  const f = join(homedir(), ".escp-maintainer.env");
  if (!existsSync(f)) return null;
  const m = readFileSync(f, "utf8").match(/ESCP_MAINTAINER_TOKEN=["']?([^"'\n]+)/);
  return m ? m[1].trim() : null;
}

/** reportOps({ pass, summary, units, produced, cost, scope }) — scope is a state code or "Name, ST". */
export async function reportOps({ pass, summary, units, produced, cost, scope } = {}) {
  const t = token(); if (!t || !summary) return false;
  const args = { pass: pass || process.env.ESCP_PASS || `manual-${new Date().toISOString().slice(0, 10)}`, summary: String(summary).slice(0, 200) };
  if (Number.isFinite(units)) args.units = units; if (Number.isFinite(produced)) args.produced = produced; if (Number.isFinite(cost)) args.cost_usd = cost;
  const sc = scope || process.env.ESCP_SCOPE; if (sc) args.scope = sc;
  try {
    const res = await fetch("https://escp-mcp-production.up.railway.app/mcp", { method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${t}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "report_ops", arguments: args } }) });
    return res.ok;
  } catch { return false; }
}
