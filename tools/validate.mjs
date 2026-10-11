// Validates data/states/*.yaml, data/districts/*.yaml and facts/claims/*.md frontmatter
// against data/schema/*.json. Exit 1 on any failure. Run: cd tools && npm i && npm run validate
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { QUARANTINE, wrongSource } from "./lib/quarantine.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = name => ajv.compile(JSON.parse(readFileSync(join(root, "data/schema", name), "utf8")));
const vState = schema("state.schema.json"), vDistrict = schema("district.schema.json"), vClaim = schema("claim.schema.json");
let failures = 0, checked = 0;
const report = (file, ok, errors) => { checked++; if (!ok) { failures++; console.error(`FAIL ${file}\n  ` + errors.map(e => `${e.instancePath || "/"} ${e.message}`).join("\n  ")); } };

const codes = new Set(), held = [];
for (const f of readdirSync(join(root, "data/states")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/states", f), "utf8"));
  report(`data/states/${f}`, vState(doc), vState.errors || []);
  if (doc?.code && `${doc.code}.yaml` !== f) report(`data/states/${f}`, false, [{ message: `code ${doc.code} does not match filename` }]);
  codes.add(doc?.code);
}
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  report(`data/districts/${f}`, vDistrict(doc), vDistrict.errors || []);
  if (doc?.state && !codes.has(doc.state)) report(`data/districts/${f}`, false, [{ message: `unknown state ${doc.state}` }]);
  const names = new Set();
  for (const d of doc?.districts || []) { if (names.has(d.name)) report(`data/districts/${f}`, false, [{ message: `duplicate district ${d.name}` }]); names.add(d.name); }
  for (const d of doc?.districts || []) { const q = wrongSource(doc.state, d); if (q) held.push([`data/districts/${f}`, d, q]); }
}
// Warnings, not failures: these records are valid, they just cite another district's document, and the
// site withholds their certificates until a corrected finding replaces the source.
for (const [file, d, q] of held) console.warn(`WARN ${file} ${d.name}: source is ${q.real_district}, ${q.real_state} (${q.issue}); certificate withheld\n  ${d.source}`);
if (held.length) console.warn(`${held.length} of ${QUARANTINE.length} entries in data/quarantine/wrong-source.json still match a record${held.length < QUARANTINE.length ? `; the other ${QUARANTINE.length - held.length} have been corrected and can be removed` : ""}`);
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
