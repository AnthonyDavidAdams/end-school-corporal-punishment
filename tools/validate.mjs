// Validates data/states/*.yaml, data/districts/*.yaml and facts/claims/*.md frontmatter
// against data/schema/*.json. Exit 1 on any failure. Run: cd tools && npm i && npm run validate
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = name => ajv.compile(JSON.parse(readFileSync(join(root, "data/schema", name), "utf8")));
const vState = schema("state.schema.json"), vDistrict = schema("district.schema.json"), vClaim = schema("claim.schema.json");
let failures = 0, checked = 0;
const report = (file, ok, errors) => { checked++; if (!ok) { failures++; console.error(`FAIL ${file}\n  ` + errors.map(e => `${e.instancePath || "/"} ${e.message}`).join("\n  ")); } };

const codes = new Set();
for (const f of readdirSync(join(root, "data/states")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/states", f), "utf8"));
  report(`data/states/${f}`, vState(doc), vState.errors || []);
  if (doc?.code && `${doc.code}.yaml` !== f) report(`data/states/${f}`, false, [{ message: `code ${doc.code} does not match filename` }]);
  codes.add(doc?.code);
}
// One document cannot be the policy of districts in two states. A name search finds "Henry County Schools" in
// Kentucky as readily as in Alabama, and 121 records were carrying a same-named district's document from another
// state before this rule (2026-11-10). Every URL a record cites, as its source or in documents[], is collected
// here and checked once all the state files are read.
const urlKey = u => String(u).trim().replace(/#.*$/, "").replace(/\/+$/, "").replace(/^http:/, "https:");
const urlStates = new Map();
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  report(`data/districts/${f}`, vDistrict(doc), vDistrict.errors || []);
  if (doc?.state && !codes.has(doc.state)) report(`data/districts/${f}`, false, [{ message: `unknown state ${doc.state}` }]);
  const names = new Set(), ncesIds = new Map();
  for (const d of doc?.districts || []) {
    if (names.has(d.name)) report(`data/districts/${f}`, false, [{ message: `duplicate district ${d.name}` }]); names.add(d.name);
    // Two rows under one federal id are two readings of one district, or an id on the wrong row. A warning, not a
    // failure: which row is right takes a person, and the rows are not merged here.
    if (d.nces_id && ncesIds.has(d.nces_id)) console.warn(`WARNING data/districts/${f}: duplicate nces_id ${d.nces_id} (${ncesIds.get(d.nces_id)} / ${d.name})`);
    else if (d.nces_id) ncesIds.set(d.nces_id, d.name);
    for (const u of [d.source, ...(Array.isArray(d.documents) ? d.documents.map(x => x?.url) : [])]) {
      if (typeof u !== "string" || !/^https?:\/\//.test(u)) continue;
      const seen = urlStates.get(urlKey(u)) || urlStates.set(urlKey(u), new Map()).get(urlKey(u));
      if (!seen.has(doc.state)) seen.set(doc.state, d.name);
    }
    // A "bans" record built from an email needs a policy code, and its quote must be the board's words, never a
    // sentence somebody wrote to us. Eighteen certificates went out on "we do not use it" before this (2026-10-27).
    if (d.status === "bans") {
      const emailed = /-email-/.test(d.source || "");
      if (!d.quote) report(`data/districts/${f}`, false, [{ message: `${d.name}: bans without a quote` }]);
      else if (emailed && !d.policy_code) report(`data/districts/${f}`, false, [{ message: `${d.name}: bans from an email with no policy code` }]);
      else if (emailed && /\b(we|our|us|I|I'm|I've|my|me|Anthony|Mr\.? Adams)\b/.test(d.quote)) report(`data/districts/${f}`, false, [{ message: `${d.name}: bans quoting a sentence written to us, not a policy` }]);
    }
  }
}
for (const [u, seen] of urlStates) if (seen.size > 1) report("data/districts", false, [{ message: `one source URL under records in ${seen.size} states (${[...seen].map(([st, n]) => `${st} ${n}`).join("; ")}): ${u}` }]);
const ids = new Set();
for (const f of readdirSync(join(root, "facts/claims")).filter(f => f.endsWith(".md"))) {
  const text = readFileSync(join(root, "facts/claims", f), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) { report(`facts/claims/${f}`, false, [{ message: "missing YAML frontmatter" }]); continue; }
  const fm = parse(m[1]);
  report(`facts/claims/${f}`, vClaim(fm), vClaim.errors || []);
  if (fm?.id && `${fm.id}.md` !== f) report(`facts/claims/${f}`, false, [{ message: `id ${fm.id} does not match filename` }]);
  if (ids.has(fm?.id)) report(`facts/claims/${f}`, false, [{ message: `duplicate id ${fm.id}` }]);
  ids.add(fm?.id);
}
console.log(`${checked} files checked, ${failures} failures`);
process.exit(failures ? 1 : 0);
