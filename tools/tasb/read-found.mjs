// Fetch every document the search turned up, clip it, and classify it.
//
// The search returns candidates with a relevance score; this is where they become findings or fail to.
// A document that does not mention the practice is a real answer -- two thirds of student handbooks do
// not, because the rule is a board policy -- so a district with three documents and no mention is
// recorded as nothing rather than guessed at.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANCHORS, NOT_THIS, hasAnchor } from "./vocabulary.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER = "https://escp-mcp-production.up.railway.app/mcp";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const IN = join(root, arg("in", "data/handbooks/found-by-search.jsonl"));
const OUT = join(root, arg("out", "data/handbooks/read.jsonl"));
const WORKERS = Number(arg("workers", 5));

async function mcp(name, args) {
  try {
    const res = await fetch(SERVER, { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(180_000) });
    const line = (await res.text()).split("\n").find((l) => l.startsWith("data: "));
    if (!line) return null;
    const r = JSON.parse(line.slice(6)).result;
    return { error: !!r.isError, text: r.content[0].text };
  } catch (err) { return { error: true, text: String(err.message || err) }; }
}

const clip = (t) => (t || "").split(/(?<=[.:;])\s+/).map((s) => s.replace(/\s+/g, " ").trim())
  .filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !NOT_THIS.some((x) => s.toLowerCase().includes(x)));

const rows = readFileSync(IN, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.documents?.length);
mkdirSync(dirname(OUT), { recursive: true });
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).district; } catch { return null; } }) : []);
const queue = rows.filter((r) => !done.has(r.district));
console.log(`${queue.length} districts with documents to read`);

let cur = 0, hit = 0, silent = 0, n = 0;
async function worker() {
  for (;;) {
    const r = queue[cur++]; if (!r) return;
    const policies = [];
    // Best-scoring first, and stop once something carries the rule: a district's own board policy
    // beats its handbook, and the ranking already put it first.
    for (const d of r.documents.slice(0, 4)) {
      const got = await mcp("fetch_document", { url: d.url, terms: ANCHORS.slice(0, 6), context_words: 500 });
      if (!got || got.error) continue;
      let j; try { j = JSON.parse(got.text); } catch { continue; }
      const text = (j.hits || []).map((h) => h.context).join("\n");
      const cands = clip(text);
      if (cands.length) { policies.push({ code: null, title: d.title, url: d.url, candidates: cands, last_revised: null }); break; }
    }
    n++;
    if (policies.length) hit++; else silent++;
    appendFileSync(OUT, JSON.stringify({ site: null, district: r.district, _state: r.state, policies }) + "\n");
    if (policies.length) console.log(`  ${r.state} ${r.district} — ${policies[0].candidates.length} sentences`);
    if (n % 25 === 0) console.log(`[${n}/${queue.length}] ${hit} with the rule, ${silent} silent`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`\n${hit}/${n} documents carry the rule, ${silent} mention it nowhere`);
