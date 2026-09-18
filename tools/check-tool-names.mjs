// Every tool this repo's prose names has to exist on the server.
//
// A contributor's agent called `list_bugs` because the docs and the tool surface disagreed about what
// existed. That is a cheap mistake to make and a cheap one to catch: ask the server what it has, then
// grep the repo for anything backticked that looks like a tool name.
//
// Usage: node tools/check-tool-names.mjs [--server https://...]   (default: the deployed server)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const SERVER = arg("--server", "https://escp-mcp-production.up.railway.app/mcp");

// Anything backticked that starts with one of the tool verbs is a tool name. Field names like
// `source_text` and `last_verified` do not start with a verb, so they are not swept up.
const TOOL_VERB = /^(get|list|claim|renew|release|search|submit|review|report|request|fetch|export|triage|resolve)_[a-z0-9_]+$/;
const SKIP = new Set(["node_modules", ".git", "site", "dist", "originals"]);

async function liveTools() {
  const res = await fetch(SERVER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`the server answered HTTP ${res.status}`);
  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data: ")) ?? body;
  const json = JSON.parse(line.replace(/^data: /, ""));
  const names = (json.result?.tools ?? []).map((t) => t.name);
  if (!names.length) throw new Error("the server listed no tools");
  return new Set(names);
}

function* docs(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* docs(p);
    else if (/\.(md|ya?ml)$/.test(e.name) && statSync(p).size < 2_000_000) yield p;
  }
}

const live = await liveTools();
const ghosts = [];
let scanned = 0;
for (const file of docs(root)) {
  scanned++;
  const body = readFileSync(file, "utf8");
  for (const m of body.matchAll(/`([a-z0-9_]{4,40})`/g)) {
    if (TOOL_VERB.test(m[1]) && !live.has(m[1])) ghosts.push({ file: relative(root, file), name: m[1] });
  }
}

console.log(`${live.size} tools live on the server; ${scanned} documents scanned.`);
if (!ghosts.length) {
  console.log("Every tool named in this repo exists.");
  process.exit(0);
}
console.log(`\n${ghosts.length} reference${ghosts.length === 1 ? "" : "s"} to a tool that does not exist:`);
for (const g of ghosts) console.log(`  ${g.file}: ${g.name}`);
console.log("\nEither the doc is stale or the tool was dropped. An agent reading this will call it and get an error.");
process.exit(1);
