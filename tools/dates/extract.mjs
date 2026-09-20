// Lifts the policy's own adoption and revision dates out of the prose in `notes` and into fields a
// program can use. Read-only unless --write.
//
// 71% of sourced records already carry these dates, written down by whoever read the policy, in
// sentences like "Original Adopted Date: 06/01/2005 | Last Revised Date: 06/17/2024". That is the
// right thing to have recorded and the wrong place to keep it: it cannot answer "which districts
// changed their policy after the year they reported striking children", which is the question the
// whole scan exists to answer.
//
// Dates taken this way are marked policy_dates_from: notes, because they are weaker than a date a
// contributor read off the policy. A note can mention a handbook's publication date, a neighbouring
// policy's revision, or a state law's effective date, and this cannot always tell those apart. So it
// only takes a date that sits within 30 characters of a label that means what it says, it refuses a
// record whose note offers two different dates for the same label, and it reports rather than guesses.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parseDocument } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const write = process.argv.includes("--write");

const MDY = /(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/((?:19|20)\d{2})/;
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const MONTH = new RegExp(`(${MONTHS})\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})`, "i");
const ISO = /((?:19|20)\d{2})-(\d{2})-(\d{2})/;
const ANY = new RegExp(`(?:${MDY.source}|${MONTH.source}|${ISO.source})`, "i");
const MONTH_N = Object.fromEntries(MONTHS.split("|").map((m, i) => [m, i + 1]));

function iso(s) {
  let m = s.match(MDY);
  if (m) return `${m[3]}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  m = s.match(MONTH);
  if (m) return `${m[3]}-${String(MONTH_N[m[1].toLowerCase()]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  m = s.match(ISO);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// Every label that means "this policy was adopted/changed on", and nothing that means "this file was
// published on" — a handbook's own date says nothing about when the board voted.
const ADOPTED = /(?:original adopted date|originally adopted|date adopted|adopted)/i;
const REVISED = /(?:last revised date|last revised|last reviewed date|last reviewed|date issued|revised|amended)/i;

// A note routinely cites the statute the policy rests on, and statutes have revision dates too. Rankin
// County's note says the policy was "last revised 08/10/2022" and, two sentences later, that it cites
// "MS Code 37-11-57, revised July 1, 2019". Both match a revision label; only one is this policy's.
const STATUTE_NEARBY = /(?:code|ann\.|stat\.|statute|§|sect(?:ion)?\s*\d|act\s+\d|h\.?b\.?\s*\d|s\.?b\.?\s*\d|laws?\s+\d)/i;
function findAll(note, label) {
  const out = new Set();
  const re = new RegExp(`${label.source}[^.;\\n]{0,30}?(${ANY.source})`, "gi");
  for (const m of note.matchAll(re)) {
    if (STATUTE_NEARBY.test(note.slice(Math.max(0, m.index - 70), m.index))) continue;
    const d = iso(m[0]);
    if (d) out.add(d);
  }
  return [...out];
}

let filled = 0, already = 0;
const conflicts = [], none = [];
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const p = join(root, "data/districts", f);
  let text = readFileSync(p, "utf8");
  const doc = parse(text);
  const edits = [];
  for (const d of doc.districts) {
    if (!d.source) continue;
    if (d.policy_adopted || d.policy_revised) { already++; continue; }
    const note = String(d.notes || "");
    const a = findAll(note, ADOPTED), r = findAll(note, REVISED);
    if (a.length > 1) { conflicts.push(`${doc.state} ${d.name}: ${a.length} adoption dates (${a.join(", ")})`); continue; }
    if (r.length > 1) {
      // A policy with several revisions prints them all; the latest is the one that is in force.
      r.sort();
      conflicts.push(`${doc.state} ${d.name}: ${r.length} revision dates (${r.join(", ")}), taking the latest`);
    }
    const adopted = a[0] ?? null, revised = r.length ? r[r.length - 1] : null;
    if (!adopted && !revised) { none.push(`${doc.state} ${d.name}`); continue; }
    filled++;
    edits.push({ d, adopted, revised });
  }
  if (write && edits.length) {
    // Spliced at the parser's own offsets; nothing is re-serialised. A YAML round trip once turned
    // "0100270" into an octal integer, and dates are exactly the shape that goes wrong that way.
    const node = parseDocument(text);
    const items = node.get("districts").items;
    const splices = [];
    for (const { d, adopted, revised } of edits) {
      const item = items.find(it => it.get("name") === d.name);
      if (!item) continue;
      const block = [
        adopted ? `    policy_adopted: "${adopted}"` : null,
        revised ? `    policy_revised: "${revised}"` : null,
        `    policy_dates_from: notes`,
        "",
      ].filter(v => v !== null).join("\n");
      splices.push({ at: item.range[2], text: block });
    }
    splices.sort((x, y) => y.at - x.at);
    for (const s of splices) text = text.slice(0, s.at) + s.text + text.slice(s.at);
    writeFileSync(p, text);
  }
}
console.log(`${write ? "filled" : "would fill"} ${filled}; ${already} already had a date; ${none.length} have no date in their notes`);
if (conflicts.length) { console.log(`\nmore than one date under the same label (${conflicts.length}):`); for (const c of conflicts.slice(0, 25)) console.log(`  ${c}`); }
