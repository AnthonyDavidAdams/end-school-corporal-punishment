// Turn harvested candidate sentences into district records, using a decision model and no writer.
//
// Two questions per district, both answered by picking rather than writing:
//
//   1. Which of these sentences establishes the district's position? A `choice` over the verbatim
//      strings the harvester clipped. The answer is an index into our own list, so the quote that
//      lands in the record is a substring of the document. Nothing generates it. The verbatim-quote
//      contract survives untouched, which a text model could not promise.
//   2. What does that sentence establish? A `choice` over the four statuses, with the opt-in versus
//      opt-out distinction spelled out, because it is the one this corpus actually turns on.
//
// Both come back with calibrated probabilities. Measured against 311 human-reviewed findings on
// 2026-09-24: 99.4% agreement overall and 100% on the 295 above 0.99 confidence
// (research/jev/README.md). So anything at or above the threshold is recorded; anything below is left
// for a person or a frontier agent, which is roughly one district in twenty.
//
//   node tools/tasb/classify.mjs [--in data/tasb/harvest.jsonl] [--out data/tasb/classified.json] [--threshold 0.99]
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const IN = join(root, arg("in", "data/tasb/harvest.jsonl"));
const OUT = join(root, arg("out", "data/tasb/classified.json"));
// Two thresholds, because they are two different jobs and only one of them has been measured.
//
// Status classification was validated against 311 human-reviewed findings: 99.4% agreement overall and
// 100% on the 295 at or above 0.99 confidence (research/jev/README.md). That number is earned.
//
// Choosing WHICH sentence is operative was never in that validation. It is a harder task -- thirteen
// sentences of a Mississippi JDB policy all mention corporal punishment and several sound like rules --
// and its confidence sits lower for that reason, not because the answer is wrong. Holding it to a bar
// measured on a different task held every correct Mississippi finding. So it gets its own threshold and
// its own caveat: this one is a judgement, not a measurement, until quote selection is validated the
// same way. Findings recorded on it carry the quote's confidence so a reviewer can see what it rested on.
const THRESHOLD = Number(arg("threshold", 0.99));
const QUOTE_THRESHOLD = Number(arg("quote-threshold", 0.90));
const MODEL = "typesafe/jev-1.13";
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY is not set."); process.exit(1); }

const STATUS = {
  allows: "Corporal punishment is permitted. This INCLUDES a policy a parent may opt OUT of by filing a written objection: the default is that it may be used unless a parent objects.",
  bans: "Corporal punishment is prohibited, not permitted, shall not be used, or has been eliminated in this district.",
  consent_required: "Corporal punishment may be used ONLY if a parent has first given affirmative permission. Opt-IN: the default is that it may NOT be used until a parent agrees.",
};

async function decide(state, questions) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, state, questions }),
        signal: AbortSignal.timeout(60_000),
      });
      const j = await res.json();
      if (j.answers) return j;
      if (attempt === 3) return { error: j.error?.message ?? "no answers" };
    } catch (err) { if (attempt === 3) return { error: String(err.message || err) }; }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

// Two harvesters, one shape. TASB gives one policy per district; Simbli gives several (JD, JDA, JDB
// and so on), so its candidate sentences are pooled and the source recorded is the policy the chosen
// sentence came from. Everything downstream is identical, which is the point of separating harvesting
// from deciding.
const rows = readFileSync(IN, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  .map((r) => {
    if (r.candidates?.length) return r;           // TASB shape
    if (!r.policies?.length) return null;          // Simbli shape
    const pool = [];
    for (const p of r.policies) for (const c of p.candidates) pool.push({ text: c, url: p.url, code: p.code, revised: p.last_revised });
    if (!pool.length) return null;
    return {
      key: r.site, district: (r.district || "").trim(), url: pool[0].url,
      candidates: pool.map((x) => x.text), _by: pool,
      date_issued: pool[0].revised ?? null,
    };
  })
  .filter((r) => r && r.district && r.candidates?.length);
console.log(`${rows.length} districts with candidate sentences`);

const out = [];
let cost = 0, recorded = 0, held = 0;
const CONCURRENCY = 8;
let cursor = 0;
async function worker() {
  while (cursor < rows.length) {
    const r = rows[cursor++];
    // Options are OUR strings, keyed by index. The model selects; it never composes.
    const options = Object.fromEntries(r.candidates.map((s, i) => [`s${i}`, s]));
    const d = await decide(
      { district: `${r.district}, Texas`, policy_excerpt_sentences: options },
      {
        operative: {
          type: "choice",
          instructions: "Which ONE of these sentences from the district's own discipline policy STATES THE RULE about whether corporal punishment may be used in this district? Choose the sentence that grants, forbids or conditions its use. Do NOT choose a sentence that merely DEFINES what corporal punishment means, nor one describing how it is carried out, who must witness it, who may administer it, or what records are kept. A definition beginning \"Corporal punishment means...\" is never the rule.",
          criteria: options,
        },
        status: {
          type: "choice",
          instructions: "Taking the district's whole policy excerpt together, what is this district's position on corporal punishment?",
          criteria: STATUS,
        },
        // Whether a parent can stop it is a separate question from whether the district does it, and
        // collapsing the two hid the worst case: a district that permits corporal punishment and gives
        // a parent no way to refuse it reads identically to Texas, where a signed statement ends it.
        parent_control: {
          type: "choice",
          instructions: "What say does a PARENT have over whether their own child is struck, according to this policy? Answer only from what the text says; if it does not address a parent's role at all, say not_stated rather than assuming.",
          criteria: {
            opt_out: "Corporal punishment may be used, but a parent can refuse it for their child -- by filing a written objection, signing a form, or otherwise saying no in advance.",
            opt_in: "Corporal punishment is not used on a child unless the parent has first given permission.",
            none: "Corporal punishment may be used and the policy gives the parent no way to prevent it. The parent may be notified, or present, or asked -- but cannot refuse.",
            not_stated: "This text does not say what say a parent has. It may be settled in another document.",
          },
        },
      }
    );
    if (d?.error) { out.push({ ...r, error: d.error }); continue; }
    cost += d.usage?.cost ?? 0;
    const op = d.answers.operative, st = d.answers.status, pc = d.answers.parent_control;
    const quote = options[op.choice] ?? null;
    const confident = st.confidence >= THRESHOLD && op.confidence >= QUOTE_THRESHOLD;
    if (confident) recorded++; else held++;
    const from = r._by?.find((x) => x.text === quote);
    out.push({
      key: r.key, district: r.district, source: from?.url ?? r.url,
      ...(from?.code ? { policy_code: from.code } : {}),
      status: st.choice, quote,
      parent_control: pc ? (pc.choice === "not_stated" ? "unknown" : pc.choice) : null,
      parent_control_confidence: pc?.confidence ?? null,
      status_confidence: st.confidence, quote_confidence: op.confidence,
      date_issued: from?.revised ?? r.date_issued, update: r.update,
      decision: confident ? "record" : "needs_review",
    });
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// A quote that is not a substring of what we clipped would mean something invented one. It cannot
// happen with a choice model, and it is asserted anyway, because that is the whole basis of the record.
const bad = out.filter((r) => r.quote && !rows.find((x) => x.key === r.key)?.candidates.includes(r.quote));
if (bad.length) { console.error(`${bad.length} quotes are not verbatim candidates -- refusing to write`); process.exit(1); }

writeFileSync(OUT, JSON.stringify(out, null, 1));
const by = {};
for (const r of out) if (r.status) by[r.status] = (by[r.status] || 0) + 1;
console.log(`${recorded} recorded (status >= ${THRESHOLD}, quote >= ${QUOTE_THRESHOLD}), ${held} held for review, ${out.filter(r=>r.error).length} errors`);
console.log(`statuses: ${JSON.stringify(by)}`);
console.log(`cost: $${cost.toFixed(4)}  (${(cost / Math.max(1, out.length)).toFixed(6)} per district)`);
