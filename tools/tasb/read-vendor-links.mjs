// Read the policy manuals districts link from their own websites.
//
// Two thirds of the documents the site walk finds do not mention corporal punishment at all. That is
// not an extraction failure: they are student handbooks, and the rule usually lives in the board
// policy manual instead. McComb's handbook runs to 104 pages without the words, and its district
// reported 52 students struck.
//
// The site walk already located 70 of those manuals, each because the district links it -- Simbli,
// TASB or BoardDocs. Those links are the best rows in the index, because a district linking S=4129
// from its own page is asserting that manual is its own. This reads them with the vendor's own reader
// rather than crawling them, which is also the only thing that works: all three serve a JavaScript
// shell to a plain fetch.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hasAnchor, NOT_THIS } from "./vocabulary.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER = "https://escp-mcp-production.up.railway.app/mcp";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = join(root, arg("out", "data/sites/vendor-read.jsonl"));

// The policy codes that carry corporal punishment in each vendor's scheme, most specific first.
const CODES = { simbli: ["JDB", "JDA", "JD", "JCD"], tasb: ["FO"] };

async function mcp(name, args) {
  try {
    const res = await fetch(SERVER, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(180_000),
    });
    const line = (await res.text()).split("\n").find((l) => l.startsWith("data: "));
    if (!line) return null;
    const r = JSON.parse(line.slice(6)).result;
    return { error: !!r.isError, text: r.content[0].text };
  } catch (err) { return { error: true, text: String(err.message || err) }; }
}

const clip = (t) => (t || "").split(/(?<=[.:;])\s+/).map((s) => s.replace(/\s+/g, " ").trim())
  .filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !NOT_THIS.some((x) => s.toLowerCase().includes(x)));

const index = JSON.parse(readFileSync(join(root, "data/sites/index.json"), "utf8"));
const jobs = [];
for (const r of index) {
  for (const d of r.documents) {
    if (!d.vendor || !d.vendor_id) continue;
    jobs.push({ state: r.state, name: r.name, nces_id: r.nces_id, vendor: d.vendor, id: d.vendor_id, link: d.url });
    break;   // one manual per district; they are the same manual under different policy codes
  }
}
mkdirSync(dirname(OUT), { recursive: true });
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).name; } catch { return null; } }) : []);
const todo = jobs.filter((j) => !done.has(j.name));
console.log(`${todo.length} districts with a vendor manual they link themselves`);

let found = 0, none = 0;
for (const j of todo) {
  let hit = null;
  if (j.vendor === "boarddocs") {
    // No reader for BoardDocs yet; record the link so it is not lost and the gap is countable.
    appendFileSync(OUT, JSON.stringify({ ...j, error: "no BoardDocs reader" }) + "\n");
    none++; continue;
  }
  for (const code of CODES[j.vendor] ?? []) {
    const args = j.vendor === "simbli" ? { site: j.id, code } : { district_key: j.id, code };
    const r = await mcp(j.vendor === "simbli" ? "fetch_simbli_policy" : "fetch_tasb_policy", args);
    if (!r || r.error) continue;
    let p; try { p = JSON.parse(r.text); } catch { continue; }
    const policies = (p.policies ?? p.hits ?? []).map((x) => ({ code: x.code ?? code, title: x.title ?? null, url: x.url ?? null, text: x.text ?? x.context ?? "", last_revised: x.last_revised ?? null }));
    const withText = policies.map((x) => ({ ...x, candidates: clip(x.text) })).filter((x) => x.candidates.length);
    if (withText.length) { hit = { policies: withText, district_in_manual: (p.district || "").trim() || null }; break; }
  }
  if (hit) { found++; console.log(`  ${j.state} ${j.name} — ${hit.policies.map((p) => `${p.code}(${p.candidates.length})`).join(" ")}`); }
  else none++;
  appendFileSync(OUT, JSON.stringify({ ...j, ...(hit ?? { error: "no policy with corporal punishment text" }) }) + "\n");
}
console.log(`\n${found} manuals read, ${none} without usable text -> ${OUT}`);
