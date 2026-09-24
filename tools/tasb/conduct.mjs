// The second document: a district's Student Code of Conduct.
//
// TASB's FO(LOCAL) tells you whether a board permits corporal punishment at all, and 291 Texas boards
// say plainly that it does not. The other 715 adopt TASB's model sentence, which ends "...in
// accordance with this policy and the Student Code of Conduct" -- and defers the parent-consent
// mechanics to a document TASB does not host. Whether a district is opt-out or opt-in is decided
// there, so FO alone cannot tell them apart, and recording those 715 as "allows" without it overstates
// what we know. Ingram ISD is the proof: FO says may-be-used, its Code of Conduct requires a parent's
// verbal approval first.
//
// Discovery is the only hard part and it is not a judgment, so no frontier model is involved here
// either: the federal directory gives every district's website, the crew server's resolve_handbook
// crawls it for candidate documents, and the decision model picks among candidates we found.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANCHORS, NOT_THIS, openSetQuestion, NEW_VOCABULARY_THRESHOLD, hasAnchor } from "./vocabulary.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER = "https://escp-mcp-production.up.railway.app/mcp";
const KEY = process.env.OPENROUTER_API_KEY;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg("limit", 5));
const OUT = join(root, arg("out", "data/tasb/conduct.jsonl"));

async function mcp(name, args) {
  const res = await fetch(SERVER, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(120_000),
  });
  const line = (await res.text()).split("\n").find((l) => l.startsWith("data: "));
  if (!line) return null;
  const r = JSON.parse(line.slice(6)).result;
  return { error: !!r.isError, text: r.content[0].text };
}

async function decide(state, questions) {
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "typesafe/jev-1.13", state, questions }),
    signal: AbortSignal.timeout(60_000),
  });
  return res.json();
}

const STATUS = {
  allows: "Corporal punishment is permitted. This INCLUDES a policy a parent may opt OUT of by filing a written objection: the default is that it may be used unless a parent objects.",
  bans: "Corporal punishment is prohibited, not permitted, or shall not be used in this district.",
  consent_required: "Corporal punishment may be used ONLY if a parent has first given affirmative permission. Opt-IN: the default is that it may NOT be used until a parent agrees.",
};

// Sentences worth asking about: they mention the practice, and are not about restraint, which is a
// safety measure and lawful everywhere. Clipped by us, so anything selected is verbatim from the file.
function candidates(text) {
  return text.split(/(?<=[.:;])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s)
                && !NOT_THIS.some((x) => s.toLowerCase().includes(x)));
}

const sites = Object.fromEntries(
  readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8").split("\n").slice(1)
    .map((l) => l.split(",")).filter((c) => c.length > 3)
    .map((c) => [c[2]?.trim().toUpperCase(), c] ).filter(([n]) => n)
);

const cls = JSON.parse(readFileSync(join(root, "data/tasb/classified.json"), "utf8"));
const wl = JSON.parse(readFileSync(join(root, "site/data/worklist.json"), "utf8"));
const web = {};
for (const d of wl.districts) if (d.state === "TX" && d.website) web[d.name.toUpperCase()] = d.website;

// The 715 that defer to a document we have not read are the ones worth the trouble.
const todo = cls.filter((r) => r.status === "allows" && web[r.district.toUpperCase()]).slice(0, LIMIT);
console.log(`${todo.length} districts to resolve\n`);

for (const r of todo) {
  const site = web[r.district.toUpperCase()];
  process.stdout.write(`${r.district}  ${site}\n`);
  const found = await mcp("resolve_handbook", { website: site, district: r.district, state: "TX", max_pages: 4 });
  if (!found || found.error) { console.log(`   resolve failed: ${found?.text?.slice(0, 90)}\n`); continue; }
  const cands = (JSON.parse(found.text).candidates || []).slice(0, 4);
  if (!cands.length) { console.log("   no candidate documents found\n"); continue; }
  console.log(`   ${cands.length} candidate documents`);

  let hit = null;
  for (const c of cands) {
    const doc = await mcp("fetch_document", { url: c.url, terms: ANCHORS.slice(0, 5), context_words: 400 });
    if (!doc || doc.error) continue;
    let j; try { j = JSON.parse(doc.text); } catch { continue; }
    const text = (j.hits || []).map((h) => h.context).join("\n");
    const sents = candidates(text);
    if (sents.length) { hit = { url: c.url, sents, title: c.title }; break; }
  }
  if (!hit) { console.log("   no corporal-punishment text in any candidate\n"); continue; }

  const options = Object.fromEntries(hit.sents.map((s, i) => [`s${i}`, s]));
  const d = await decide(
    { district: `${r.district}, Texas`, document: "Student Code of Conduct", sentences: options },
    {
      operative: { type: "choice", instructions: "Which ONE of these sentences states the rule about whether corporal punishment may be used, including any parent permission it requires?", criteria: options },
      status: { type: "choice", instructions: "Taking these together, what is this district's position on corporal punishment?", criteria: STATUS },
    }
  );
  if (!d?.answers) { console.log(`   decision failed\n`); continue; }
  const st = d.answers.status, op = d.answers.operative;
  const row = {
    district: r.district, source: hit.url, board_policy_status: r.status,
    conduct_status: st.choice, confidence: Math.min(st.confidence, op.confidence),
    quote: options[op.choice],
  };
  appendFileSync(OUT, JSON.stringify(row) + "\n");
  const flag = row.conduct_status !== r.status ? "  <-- DIFFERS from board policy" : "";
  console.log(`   ${st.choice} (conf ${row.confidence.toFixed(2)})${flag}\n     "${row.quote.slice(0, 120)}"\n`);
}
