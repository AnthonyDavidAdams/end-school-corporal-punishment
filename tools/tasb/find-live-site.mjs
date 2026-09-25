// Find where a district's website actually lives now.
//
// The federal directory is the 2023-24 file and there is no newer one, so its URLs decay and nothing
// refreshes them. Crossett School District is listed at crossett.k12.ar.us, which no longer resolves;
// the district is at crossettschools.org. West Memphis is listed at west.grsc.k12.ar.us and lives at
// wmsd.net. Those addresses come back as nothing at all, which reads exactly like a hostile server and
// is not one -- most of a day was spent hardening fetches against a problem that was a dead domain.
//
// Guessing does not work: patterns like <name>schools.org found two of five, and one of those was
// behind a bot wall anyway. Keyless search is gone -- DuckDuckGo, Mojeek, Startpage and Marginalia all
// answer a plain request with zero results, through a residential proxy as readily as without one.
//
// So: a search API for candidates, and the decision model to say which candidate is the district. The
// ranking costs about two hundredths of a cent for ten results and can answer "none of these", which
// matters more than picking well -- a confidently wrong website sends every later step to the wrong
// district's policy.
//
//   BRAVE_API_KEY=... node tools/tasb/find-live-site.mjs --in stale.json --out data/handbooks/sites.jsonl
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BRAVE = process.env.BRAVE_API_KEY;
const JEV = process.env.OPENROUTER_API_KEY;
const OUT = join(root, arg("out", "data/handbooks/sites.jsonl"));

// Brave's free tier is 2,000 queries a month and one query settles one district, so the whole backlog
// of dead addresses fits inside it with room to spare. Any search API returning {title, url, snippet}
// drops in here; nothing below depends on Brave specifically.
async function search(q) {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10&country=us`, {
    headers: { Accept: "application/json", "X-Subscription-Token": BRAVE },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Brave returned ${res.status}${res.status === 401 ? " -- check BRAVE_API_KEY" : ""}`);
  const j = await res.json();
  return (j.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: (r.description || "").slice(0, 200) }));
}

// One noul per result, answered in a single request. The options are results we were handed, so the
// model can only select among real URLs -- it has no way to invent a domain.
async function rank(district, state, results) {
  const questions = {};
  results.forEach((r, i) => {
    questions[`r${i}`] = {
      type: "noul",
      instructions: `Result: "${r.title}" — ${r.url}\n${r.snippet}\n\nIs this the OFFICIAL website of ${district} in ${state}? Not a news story about it, not a ratings site like Niche or GreatSchools, not a single school inside the district, not a neighbouring district with a similar name, and not a state or federal directory page listing it.`,
      criteria: {
        true: `This is ${district}'s own website, run by the district.`,
        false: "Anything else: a directory listing, a ratings site, a news article, a jobs board, a single campus, or a different district.",
      },
    };
  });
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: `Bearer ${JEV}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "typesafe/jev-1.13", state: { district, state_name: state }, questions }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json();
  if (!j.answers) return { error: j.error?.message ?? "no answers" };
  const scored = results.map((r, i) => ({ ...r, p: j.answers[`r${i}`]?.noul ?? 0 })).sort((a, b) => b.p - a.p);
  return { scored, cost: j.usage?.cost ?? 0 };
}

// Believing the top result regardless of score is how a district ends up pointed at its neighbour.
const CONFIDENT = Number(arg("threshold", 0.8));

export async function findLiveSite(district, state) {
  const results = await search(`${district} ${state} school district official website`);
  if (!results.length) return { district, state, error: "no search results" };
  const r = await rank(district, state, results);
  if (r.error) return { district, state, error: r.error };
  const top = r.scored[0];
  return top.p >= CONFIDENT
    ? { district, state, site: top.url, title: top.title, confidence: top.p, cost: r.cost }
    : { district, state, error: `nothing confidently the district's own site (best ${top.p.toFixed(2)}: ${top.url})`, candidates: r.scored.slice(0, 3), cost: r.cost };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!BRAVE) { console.error("BRAVE_API_KEY is not set. Free tier: https://brave.com/search/api/ (2,000 queries a month; this needs about 250)."); process.exit(1); }
  if (!JEV) { console.error("OPENROUTER_API_KEY is not set."); process.exit(1); }
  const targets = JSON.parse(readFileSync(join(root, arg("in", "data/handbooks/stale.json")), "utf8"));
  mkdirSync(dirname(OUT), { recursive: true });
  let cost = 0, found = 0;
  for (const t of targets) {
    let r; try { r = await findLiveSite(t.name, t.state); } catch (e) { r = { district: t.name, state: t.state, error: String(e.message || e) }; }
    cost += r.cost || 0;
    if (r.site) found++;
    appendFileSync(OUT, JSON.stringify({ ...r, listed: t.website }) + "\n");
    console.log(r.site ? `  ${t.name}\n     ${r.site}  (${r.confidence.toFixed(2)}, listed as ${t.website})` : `  ${t.name}: ${r.error}`);
    await new Promise((s) => setTimeout(s, 1100));   // Brave's free tier is one query a second.
  }
  console.log(`\n  ${found}/${targets.length} resolved, $${cost.toFixed(4)} of ranking`);
}
