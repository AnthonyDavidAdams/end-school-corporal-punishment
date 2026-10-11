// Can a searching model find the document we could not? A pilot: for districts with no quoted rule,
// ask an OpenAI model with web search (through OpenRouter's web plugin) for the URL of the district's
// current board policy or handbook section on corporal punishment and the exact sentence. Then do what
// we do with every lead: fetch the document ourselves, and keep the lead only if the sentence is in it.
// A model's claim is never a source; the document is.
//
//   node tools/find/llm-find.mjs --states OK,MO,TN --n 20 [--model openai/gpt-5.4-mini]
//   -> out/llm-find/<date>.jsonl  (one row per district: lead, verified, candidates)
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { hasAnchor, NOT_THIS } from "../tasb/vocabulary.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const STATES = arg("states", "OK,MO,TN").split(",");
const N = Number(arg("n", 20));
const MODEL = arg("model", "openai/gpt-5.4-mini");
const KEY = (readFileSync(join(process.env.HOME, "personality-bench/.env.local"), "utf8").match(/OPENROUTER[^=]*=\s*"?([^"\n]+)/) || [])[1];
const DAY = new Date().toISOString().slice(0, 10);
mkdirSync(join(root, "out/llm-find"), { recursive: true });
const OUT = join(root, `out/llm-find/${DAY}.jsonl`);

// districts with no quoted rule, with the website the federal directory has for them
const lea = new Map();
for (const line of readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8").split("\n").slice(1)) {
  const c = line.split(","); if (c.length > 5) lea.set(c[0], { website: c[4], city: c[6] });
}
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).nces_id) : []);
const todo = [];
for (const st of STATES) {
  const doc = parseYaml(readFileSync(join(root, `data/districts/${st}.yaml`), "utf8"));
  for (const r of doc.districts) {
    if (r.quote || !["silent", "unknown"].includes(r.status) || !r.nces_id || done.has(String(r.nces_id))) continue;
    todo.push({ state: st, name: r.name, nces_id: String(r.nces_id), website: lea.get(String(r.nces_id))?.website || "", city: lea.get(String(r.nces_id))?.city || "" });
  }
}
// spread across the states
const pick = []; const byState = Object.fromEntries(STATES.map((s) => [s, todo.filter((t) => t.state === s)]));
for (let i = 0; pick.length < N && STATES.some((s) => byState[s].length); i++) for (const s of STATES) if (pick.length < N && byState[s].length) pick.push(byState[s].shift());
console.log(`${todo.length} unquoted in ${STATES.join("/")}; trying ${pick.length} with ${MODEL} + web search`);

const STATE_NAME = { OK: "Oklahoma", MO: "Missouri", TN: "Tennessee", KS: "Kansas", AR: "Arkansas", GA: "Georgia", MS: "Mississippi", AL: "Alabama", LA: "Louisiana", FL: "Florida", IN: "Indiana", NC: "North Carolina", SC: "South Carolina", TX: "Texas", KY: "Kentucky", WY: "Wyoming" };

async function ask(d) {
  const prompt = `Find the CURRENT written rule on corporal punishment for the public school district "${d.name}" in ${STATE_NAME[d.state] || d.state}${d.city ? ` (${d.city})` : ""}${d.website ? `, website ${d.website}` : ""}.
Look for the district's own board policy (often a policy manual on BoardDocs, Simbli/eBoardSolutions, a state association portal, or a PDF on the district site) or its student handbook / code of conduct. The rule may permit corporal punishment, prohibit it, or permit it only with parental consent.
Return JSON only: {"url": "<direct URL of the document or policy page that contains the sentence>", "sentence": "<the exact sentence about corporal punishment, copied verbatim>", "document": "<board policy|student handbook|other>", "confidence": <0-1>}. If you cannot find the district's own document, return {"url": null, "sentence": null, "confidence": 0}. Never guess a URL; only return one you actually opened.`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, plugins: [{ id: "web", max_results: 5 }], max_tokens: 700, temperature: 0, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content || "";
  const m = text.match(/\{[\s\S]*\}/);
  let lead = null; try { lead = m ? JSON.parse(m[0]) : null; } catch {}
  return { lead, usage: j.usage, raw: text.slice(0, 400) };
}

function fetchText(url) {
  try {
    const bin = execFileSync("curl", ["-sL", "-m", "45", "-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", url], { maxBuffer: 60e6 });
    if (bin.subarray(0, 5).toString() === "%PDF-") {
      const tmp = join(root, "out/llm-find/tmp.pdf"); writeFileSync(tmp, bin);
      return execFileSync("pdftotext", ["-layout", tmp, "-"], { maxBuffer: 60e6 }).toString();
    }
    return bin.toString("utf8").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"');
  } catch { return ""; }
}
const norm = (s) => (s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const clip = (t) => t.split(/(?<=[.;:])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 30 && s.length < 600 && hasAnchor(s) && !NOT_THIS.some((n) => s.toLowerCase().includes(n)));

let found = 0, verified = 0, cost = 0;
for (const d of pick) {
  const { lead, usage, raw } = await ask(d);
  cost += (usage?.cost ?? 0) + 0.01;
  const row = { nces_id: d.nces_id, state: d.state, name: d.name, model: MODEL, lead, verified: false, candidates: [], raw };
  if (lead?.url) {
    found++;
    const text = fetchText(lead.url);
    row.fetched_chars = text.length;
    const cands = clip(text);
    row.candidates = cands.slice(0, 40);
    row.sentence_in_document = !!(lead.sentence && norm(text).includes(norm(lead.sentence).slice(0, 80)));
    row.verified = row.sentence_in_document || cands.length > 0;
    if (row.verified) verified++;
  }
  appendFileSync(OUT, JSON.stringify(row) + "\n");
  console.log(`${d.state} ${d.name.padEnd(34).slice(0, 34)} ${lead?.url ? (row.verified ? "VERIFIED " : "lead, not verified ") : "nothing "} ${lead?.url ? lead.url.slice(0, 90) : ""}`);
}
console.log(`\n${pick.length} tried, ${found} leads, ${verified} verified against the fetched document, ~$${cost.toFixed(2)} -> ${OUT}`);
