// Search for the document itself, rather than for the district's website.
//
// Everything so far has gone district -> website -> crawl -> document, and the crawl is where it
// breaks: Kennett's home page carries 34 links and not one points at a policy, so two levels of
// walking find nothing that is there to find. Arkansas, Oklahoma and Missouri are 248 of the 368
// districts still unread and they are exactly this shape -- no central policy vendor, thin sites, and
// a handbook that is published but not linked from the front page.
//
// A search engine has already crawled all of it. So ask for the document: "<district> <state> student
// handbook", take every result, and have the decision model say which ones are this district's own
// discipline document rather than a neighbouring district's, a ratings page, or a news story. The
// options are results we were handed, so nothing can be invented, and "none of these" is always
// available -- which matters, because a confidently wrong handbook attributes one district's policy to
// another.
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BRAVE = process.env.BRAVE_API_KEY, JEV = process.env.OPENROUTER_API_KEY;
const OUT = join(root, arg("out", "data/handbooks/found-by-search.jsonl"));
const KEEP = Number(arg("keep", 0.6));

async function search(q) {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=15&country=us`,
    { headers: { Accept: "application/json", "X-Subscription-Token": BRAVE }, signal: AbortSignal.timeout(30_000) });
  // A quota or billing refusal is not "no results". Recorded as an empty search it silently marks a
  // district as looked-at-and-empty when nothing ever looked, which is what happened to 99 of them.
  if (r.status === 402 || r.status === 429) {
    const body = await r.text().catch(() => "");
    throw Object.assign(new Error(`Brave refused: ${r.status} ${body.slice(0, 160)}`), { fatal: true });
  }
  if (!r.ok) throw new Error(`Brave ${r.status}`);
  const j = await r.json();
  return (j.web?.results ?? []).map((x) => ({ title: x.title, url: x.url, snippet: (x.description || "").slice(0, 220) }));
}

// One noul per result, answered together. A district may publish several relevant documents -- a code
// of conduct and a board policy and a handbook -- so this keeps every one above the bar rather than
// choosing, which is the same lesson the sentence selection taught.
async function rank(district, state, results) {
  const questions = {};
  results.forEach((r, i) => {
    questions[`r${i}`] = {
      type: "noul",
      instructions: `Result: "${r.title}"\n${r.url}\n${r.snippet}\n\nIs this a document published by ${district} in ${state} setting out its own student discipline rules -- its student handbook, student code of conduct, or board policy manual?`,
      criteria: {
        true: `Yes: a handbook, code of conduct or board policy belonging to ${district} itself.`,
        false: "No: a different district (including a similarly named one in another state), a single school's page where the district's rules are not stated, a ratings or directory site, a news article, a state agency page, a jobs posting, or an employee handbook.",
      },
    };
  });
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST", headers: { Authorization: `Bearer ${JEV}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "typesafe/jev-1.13", state: { district, state_name: state }, questions }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json();
  if (!j.answers) return { kept: [], cost: 0, error: j.error?.message };
  const scored = results.map((r, i) => ({ ...r, p: j.answers[`r${i}`]?.noul ?? 0 })).sort((a, b) => b.p - a.p);
  return { scored, kept: scored.filter((r) => r.p >= KEEP), cost: j.usage?.cost ?? 0 };
}

// Two queries: the handbook a parent would look for, and the policy a board would file. They surface
// different documents, and for this question the second is usually the one that answers it.
// Query sets, because the first pass taught what the second needs.
//
// Searching for a handbook finds handbooks, and 103 districts came back with one that never mentions
// corporal punishment -- most student handbooks summarise conduct and leave this to a board policy.
// So a second pass asks for the board policy by the words those documents actually use, and a third
// asks for the practice itself, which sometimes surfaces the one page of a manual that carries it.
const QUERY_SETS = {
  handbook: (d, s) => [
    `"${d}" ${s} student handbook code of conduct`,
    `"${d}" ${s} board policy corporal punishment discipline`,
  ],
  policy: (d, s) => [
    `"${d}" ${s} board policy manual corporal punishment`,
    `"${d}" ${s} "corporal punishment" policy paddling`,
  ],
  practice: (d, s) => [
    `"${d}" ${s} corporal punishment paddling students`,
    `${d} ${s} school board policy JDB corporal punishment`,
  ],
};
const QUERIES = (d, s) => (QUERY_SETS[arg("queries", "handbook")] ?? QUERY_SETS.handbook)(d, s);

export async function findDocuments(district, state) {
  const seen = new Map();
  let cost = 0;
  for (const q of QUERIES(district, state)) {
    let results;
    try { results = await search(q); }
    catch (e) {
      // Stop the whole run on a quota refusal rather than writing hundreds of false empties.
      if (e.fatal) { console.error(`\n  ${e.message}\n  Stopping: every district after this would be recorded as searched-and-empty without being searched.`); process.exit(2); }
      return { district, state, error: String(e.message), cost };
    }
    if (!results.length) continue;
    const r = await rank(district, state, results);
    cost += r.cost;
    for (const k of r.kept) if (!seen.has(k.url)) seen.set(k.url, k);
    await new Promise((s2) => setTimeout(s2, 1100));   // Brave free tier: one query a second.
  }
  return { district, state, documents: [...seen.values()].sort((a, b) => b.p - a.p).slice(0, 6), cost };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!BRAVE || !JEV) { console.error("Needs BRAVE_API_KEY and OPENROUTER_API_KEY."); process.exit(1); }
  const targets = JSON.parse(readFileSync(join(root, arg("in", "data/handbooks/unread.json")), "utf8"));
  mkdirSync(dirname(OUT), { recursive: true });
  const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).district; } catch { return null; } }) : []);
  const queue = targets.filter((t) => !done.has(t.name));
  console.log(`${queue.length} districts to search for`);
  let cost = 0, hit = 0, n = 0;
  for (const t of queue) {
    const r = await findDocuments(t.name, t.state);
    cost += r.cost || 0; n++;
    if (r.documents?.length) { hit++; console.log(`  ${t.state} ${t.name} — ${r.documents.length}: ${r.documents[0].p.toFixed(2)} ${r.documents[0].title.slice(0, 52)}`); }
    appendFileSync(OUT, JSON.stringify({ ...r, students: t.students }) + "\n");
    if (n % 25 === 0) console.log(`[${n}/${queue.length}] ${hit} found, $${cost.toFixed(4)}`);
  }
  console.log(`\n${hit}/${n} districts with a document, $${cost.toFixed(4)}`);
}
