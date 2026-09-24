// Harvest Georgia, Alabama and Mississippi from Simbli, the way Texas was harvested from TASB.
//
// Simbli (eBOARDsolutions) serves the board policy manuals for much of the south, and its site numbers
// are allocated in blocks: the old short ones per state (Alabama around 2000-2200, Georgia 4000-4200)
// and a newer global sequence where Mississippi sits densely between 36031677 and 36031853. So the
// same trick applies -- walk the numbers, read the district's name off its own manual, take the
// policies whose titles are about discipline, and keep their text.
//
// The crew server already knows how to talk to Simbli: the session token dance, the challenge-page
// retry, the pacing that stopped us being blocked once already. This goes through it rather than
// reimplementing any of that, which also means every fetch is cached and paced for the whole fleet.
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hasAnchor, NOT_THIS } from "./vocabulary.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER = "https://escp-mcp-production.up.railway.app/mcp";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const FROM = Number(arg("from", 36031677)), TO = Number(arg("to", 36031853));
const OUT = join(root, arg("out", "data/simbli/harvest.jsonl"));
const WORKERS = Number(arg("workers", 4));

async function mcp(name, args) {
  try {
    const res = await fetch(SERVER, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(180_000),
    });
    const line = (await res.text()).split("\n").find((l) => l.startsWith("data: "));
    if (!line) return null;
    const r = JSON.parse(line.slice(6)).result;
    return { error: !!r.isError, text: r.content[0].text };
  } catch (err) { return { error: true, text: String(err.message || err) }; }
}

// Sentences we clipped ourselves, so whatever is chosen downstream is verbatim from the policy.
const clip = (text) => (text || "").split(/(?<=[.:;])\s+/)
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s)
              && !NOT_THIS.some((x) => s.toLowerCase().includes(x)));

mkdirSync(dirname(OUT), { recursive: true });
const done = new Set(existsSync(OUT)
  ? readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).site; } catch { return null; } })
  : []);

const queue = [];
for (let s = FROM; s <= TO; s++) if (!done.has(String(s))) queue.push(String(s));
console.log(`${queue.length} Simbli site numbers to try (${FROM}..${TO}), ${WORKERS} at a time`);

let found = 0, empty = 0, errs = 0, seen = 0;
async function worker() {
  for (;;) {
    const site = queue.shift();
    if (!site) return;
    // Ask by policy CODE, not by searching the manual's text.
    //
    // A term search over the index returns whatever mentions corporal punishment, and in Mississippi
    // that is usually the wrong document: JD and JCD carry the state's teacher-immunity clause
    // (§ 37-11-57) and a line saying "refer to policy JDB". That is state law about liability, not a
    // board's decision about its own schools, and classifying it read as though the district had
    // chosen something it had not. JDB is the policy, it exists, and it was one request away --
    // Baldwyn's is 3,777 characters, revised 2019, and says plainly what the board permits.
    let r = await mcp("fetch_simbli_policy", { site, code: "JDB" });
    let j = null;
    if (r && !r.error) { try { j = JSON.parse(r.text); } catch { j = null; } }
    const gotPolicy = (x) => (x?.policies || []).some((p) => (p.text || "").length > 500);
    // Fall back to the index search only where there is no JDB: some districts put the rule elsewhere.
    if (!gotPolicy(j)) {
      r = await mcp("fetch_simbli_policy", { site });
      if (r && !r.error) { try { j = JSON.parse(r.text); } catch { j = null; } }
    }
    seen++;
    if (!j) { errs++; appendFileSync(OUT, JSON.stringify({ site, error: (r?.text || "").slice(0, 140) }) + "\n"); continue; }
    const district = j.district || j.site_name || null;
    // Every policy body the district publishes on discipline, with our own candidate sentences.
    const policies = (j.policies || []).map((p) => ({
      code: p.code, title: p.title, url: p.url, last_revised: p.last_revised,
      candidates: clip(p.text), chars: p.chars,
    })).filter((p) => p.candidates.length);
    if (district && policies.length) found++; else empty++;
    appendFileSync(OUT, JSON.stringify({ site, district, policies, policies_in_index: j.policies_in_index ?? null }) + "\n");
    if (district && policies.length) process.stdout.write(`\n  ${site} ${district.trim()} — ${policies.map((p) => `${p.code}(${p.candidates.length})`).join(" ")}`);
    if (seen % 20 === 0) process.stdout.write(`\n[${seen}/${seen + queue.length}] ${found} districts, ${empty} empty, ${errs} errors`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`\ndone: ${found} districts, ${empty} with nothing, ${errs} errors -> ${OUT}`);
