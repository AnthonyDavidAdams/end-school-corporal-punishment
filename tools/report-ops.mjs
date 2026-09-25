// Tell the crew server what a pipeline just did, so the public board shows it.
//   node tools/report-ops.mjs <pass> <summary> [units] [produced] [cost] [scope]
import { readFileSync } from "node:fs";
const [pass, summary, units, produced, cost, scope] = process.argv.slice(2);
const token = process.env.ESCP_MAINTAINER_TOKEN;
if (!token) { console.error("ESCP_MAINTAINER_TOKEN is not set."); process.exit(1); }
const res = await fetch("https://escp-mcp-production.up.railway.app/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "report_ops", arguments: {
    pass, summary,
    ...(units ? { units: Number(units) } : {}), ...(produced ? { produced: Number(produced) } : {}),
    ...(cost ? { cost_usd: Number(cost) } : {}), ...(scope ? { scope } : {}), token } } }),
});
const line = (await res.text()).split("\n").find((l) => l.startsWith("data: "));
console.log(line ? JSON.parse(line.slice(6)).result.content[0].text.slice(0, 160) : "no response");
