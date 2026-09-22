// Fills each district record's NCES id and official contact from the federal LEA directory, which is a
// citable public file rather than a scrape. Read-only unless --write.
//
// Usage: node tools/nces/backfill.mjs [--state XX] [--write]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parseDocument } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const write = argv.includes("--write");
const onlyState = argv.includes("--state") ? argv[argv.indexOf("--state") + 1] : null;
const SOURCE = "https://nces.ed.gov/ccd/Data/zip/ccd_lea_029_2324_w_1a_073124.zip";

import { norm, kind } from "../lib/district-name.mjs";

// Minimal CSV reader: the directory has quoted fields with commas in the district names.
function rows(text) {
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
const raw = rows(readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8"));
const head = raw[0];
const dir = raw.slice(1).filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
const byId = new Map(dir.map(r => [r.nces_id, r]));
// 19,280 districts in one file means name collisions are ordinary, not exceptional. Any key claimed by
// more than one district is unusable: two Harmony Groves in Arkansas cannot be told apart by name, and
// filling one of them in would be a coin flip recorded as a fact.
const byName = new Map();
for (const r of dir) { const k = `${r.state}|${norm(r.name)}|${kind(r.name)}`; (byName.get(k) || byName.set(k, []).get(k)).push(r); }

const esc = s => String(s).replace(/"/g, '\\"');
let idFilled = 0, contactFilled = 0, already = 0;
const disagree = [], ambiguous = [], unmatched = [];
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const p = join(root, "data/districts", f);
  let text = readFileSync(p, "utf8");
  const doc = parse(text);
  const edits = [];
  if (onlyState && doc.state !== onlyState) continue;
  for (const d of doc.districts) {
    if (!d.source) continue;
    let hit = null;
    if (d.nces_id && byId.has(d.nces_id)) {
      const c = byId.get(d.nces_id);
      if (norm(c.name) === norm(d.name) && kind(c.name) === kind(d.name)) hit = c;
      else { disagree.push(`${doc.state} ${d.name}: id ${d.nces_id} is "${c.name}"`); continue; }
    }
    if (!hit) {
      const cands = byName.get(`${doc.state}|${norm(d.name)}|${kind(d.name)}`) || [];
      if (cands.length === 1) hit = cands[0];
      else if (cands.length > 1) { ambiguous.push(`${doc.state} ${d.name}: ${cands.map(c => `${c.name} (${c.nces_id})`).join(" | ")}`); continue; }
      else { unmatched.push(`${doc.state} ${d.name}`); continue; }
    }
    const mailing = [hit.street, `${hit.city}, ${hit.zip_state} ${hit.zip}`].filter(Boolean).join(", ");
    const needsId = !d.nces_id;
    // Only ADD a contact block where there is none. The earlier version appended one whenever the
    // phone or address was missing, which on a record that already had a partial contact -- a
    // contact_page from a scan, say -- produced a second `contact:` key under the same district and
    // broke the file. Filling individual fields into an existing block is a different job; a record
    // that has a contact keeps it, and tools/contact/harvest.mjs adds to it.
    const needsContact = !d.contact;
    if (!needsId && !needsContact) { already++; continue; }
    if (needsId) idFilled++;
    if (needsContact) contactFilled++;
    if (!write) continue;

    edits.push({ d, hit, mailing, needsId, needsContact });
  }
  if (write && edits.length) {
    // Edits are spliced at offsets the YAML parser reports, not at offsets a regex guesses. The regex
    // version of this matched a record's lines by indentation, which is wrong: a multi-line double
    // quoted scalar continues at an indentation the pattern does not recognise, so the block ended in
    // the middle of Walker County's quote and the contact was written inside it. The file stopped
    // parsing. parseDocument gives the real boundaries of every node, so there is nothing to guess at,
    // and the file is still edited as text so no scalar is ever re-serialised: a round trip once turned
    // "0100270" into an octal integer and "8:05" into a sexagesimal one.
    const docNode = parseDocument(text);
    const items = docNode.get("districts").items;
    const splices = [];
    for (const { d, hit, mailing, needsId, needsContact } of edits) {
      const item = items.find(it => it.get("name") === d.name);
      if (!item) { unmatched.push(`${doc.state} ${d.name} (no node to patch)`); continue; }
      if (needsId) {
        const node = item.get("nces_id", true);
        if (node?.range) splices.push({ at: node.range[0], to: node.range[1], text: `"${hit.nces_id}"` });
      }
      if (needsContact) {
        // End of the record's last value, before the trailing newline the parser includes.
        const end = item.range[2];
        const block = [
          `    contact:`,
          `      phone: "${esc(hit.phone)}"`,
          `      mailing_address: "${esc(mailing)}"`,
          hit.website ? `      website: "${esc(hit.website)}"` : null,
          `      as_of: 2023-24`,
          `      source: ${SOURCE}`,
          ``,
        ].filter(v => v !== null).join("\n");
        splices.push({ at: end, to: end, text: block });
      }
    }
    splices.sort((a, b) => b.at - a.at);           // back to front, so earlier offsets stay valid
    for (const sp of splices) text = text.slice(0, sp.at) + sp.text + text.slice(sp.to);
  }
  if (write) writeFileSync(p, text);
}
console.log(`${write ? "filled" : "would fill"}: ${idFilled} NCES ids, ${contactFilled} contact blocks; ${already} already complete`);
for (const [label, list] of [["id points at a different district", disagree], ["name claimed by more than one district", ambiguous], ["not in the directory", unmatched]])
  if (list.length) { console.log(`\n${label} (${list.length}):`); for (const x of list.slice(0, 30)) console.log(`  ${x}`); if (list.length > 30) console.log(`  ... and ${list.length - 30} more`); }
