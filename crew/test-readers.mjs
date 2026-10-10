// Live test for the vendor readers in crew/readers/: registers crew/tools.mjs against a stub server and
// calls each reader on real districts. Needs the network. Usage: node crew/test-readers.mjs
import assert from "node:assert/strict";
import { registerTools } from "./tools.mjs";
import { docxText, wordXmlText } from "./readers/docx.mjs";
import { kasbTarget, kasbText, kasbDates } from "./readers/kasb.mjs";
import { policyLinks, resolveManual, tsbaDates } from "./readers/tsba.mjs";

// Schemas are only declared at registration; a chainable stub stands in for zod so this runs without
// installing the engine.
const z = new Proxy(function () {}, { get: () => z, apply: () => z });
const handlers = new Map();
const server = { registerTool: (name, _def, fn) => handlers.set(name, fn) };
const store = new Map();
const documents = {
  put: (url, text, meta = {}) => { store.set(url, { ...meta, url, text }); return store.get(url); },
  read: (url) => store.get(url) ?? null,
  get: async (url) => {
    if (store.has(url)) return store.get(url);
    throw new Error(`stub document cache cannot fetch ${url}`);
  },
};
const text = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const fail = (msg, extra = {}) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: msg, ...extra }) }] });
const ctx = { crew: { crew: { document_terms: ["corporal punishment"] } } };

const names = await registerTools(server, ctx, { z, text, fail, documents, egressFetch: null });
let passed = 0;
const ok = (name) => { passed++; console.log(`ok - ${name}`); };
const call = async (name, args) => {
  const r = await handlers.get(name)(args);
  const body = JSON.parse(r.content[0].text);
  assert.ok(!r.isError, `${name} ${JSON.stringify(args)} failed: ${body.error} ${body.next ?? ""}`);
  return body;
};
const failing = async (name, args) => {
  const r = await handlers.get(name)(args);
  assert.ok(r.isError, `${name} ${JSON.stringify(args)} should have failed`);
  return JSON.parse(r.content[0].text);
};

for (const t of ["fetch_kasb_policy", "fetch_tsba_policy"]) assert.ok(names.includes(t) && handlers.has(t), `missing ${t}`);
ok(`registered: ${names.join(", ")}`);

// ---- offline pieces ----
assert.deepEqual(kasbTarget("https://policy.kasb.org/kansas/browse/Udallusd463/Udallusd463/sop0000169658"), { showset: "Udallusd463", collection: "Udallusd463", sop: "sop0000169658" });
assert.deepEqual(kasbTarget("Holtonusd336"), { showset: "Holtonusd336", collection: null, sop: null });
const kt = kasbText("<p>Approved:&#xa0; 3/10/22; 11/10/25</p><p>KASB Recommendation&ndash;7/96; 4/07</p>");
assert.deepEqual(kasbDates(kt), { approved: ["3/10/22", "11/10/25"], last_approved: "11/10/25", kasb_recommendation: ["7/96", "4/07"] });
assert.equal(wordXmlText('<w:p><w:r><w:instrText>DATE</w:instrText><w:t xml:space="preserve">A &amp; B</w:t><w:tab/><w:t>C</w:t></w:r></w:p>'), "A & B\tC");
assert.deepEqual(tsbaDates("Issued Date:\n08/10/23\n\tRescinds:\n6.314\n\tIssued:\n11/12/09"), { issued_date: "08/10/23", rescinds: { code: "6.314", issued: "11/12/09" } });
assert.deepEqual(tsbaDates("Rescinds:\n\n6.314\n\nIssued Date:\n\n07/10/23\nIssued:\n\n08/13/18"), { issued_date: "07/10/23", rescinds: { code: "6.314", issued: "08/13/18" } });
const rows = policyLinks('<tr><td><a href="https://tsbanet.sharepoint.com/:b:/g/PDF">6.314</a></td><td>Corporal Punishment</td></tr><tr><td><a href="https://tsbanet.sharepoint.com/:w:/g/DOC">6.314</a></td><td><span>Corporal Punishment</span></td></tr>', "6.314");
assert.equal(rows[0].kind, "docx"); assert.equal(rows[0].title, "Corporal Punishment");
const man = ["https://tsba.net/henry-county-board-of-education-policy-manual/", "https://tsba.net/lexington-board-of-education-policy-manual/"];
assert.equal(resolveManual(man, "Henry County Schools").match, man[0]);
assert.equal(resolveManual(man, "Wilson County").match, null);
ok("parsers: KASB targets, entities and dates; docx run text; TSBA rows, dates and manual matching");

// ---- KASB, live ----
for (const showset of ["Udallusd463", "Holtonusd336", "Wellingtonusd353"]) {
  const r = await call("fetch_kasb_policy", { showset });
  const p = r.policies?.[0];
  assert.ok(p && /corporal punishment/i.test(p.text), `${showset}: no corporal punishment text`);
  assert.equal(p.code, "JDA");
  assert.ok(p.last_approved, `${showset}: no Approved date`);
  assert.ok(store.get(p.url)?.text.includes(p.text.slice(0, 60)), `${showset}: text not cached under ${p.url}`);
  ok(`fetch_kasb_policy ${showset}: ${p.code} "${p.hits[0]?.context.slice(0, 70)}" approved ${p.approved.join("; ")}`);
}
{
  const r = await call("fetch_kasb_policy", { showset: "https://policy.kasb.org/kansas/browse/Holtonusd336/Holtonusd336/sop0000484576" });
  assert.ok(/corporal punishment/i.test(r.policies[0].text));
  const f = await failing("fetch_kasb_policy", { showset: "Montezumausd371" });
  assert.match(f.error, /no manual under the ShowSet/);
  ok("fetch_kasb_policy: direct browse URL reads; unknown ShowSet fails with a next step");
}

// ---- TSBA, live ----
for (const district of ["Henry County", "Lexington", "Moore County"]) {
  const r = await call("fetch_tsba_policy", { district });
  assert.ok(/corporal punishment/i.test(r.text), `${district}: no corporal punishment text`);
  assert.ok(r.issued_date, `${district}: no Issued Date`);
  assert.match(r.source, /tsbanet\.sharepoint\.com\/:w:\//);
  assert.ok(store.get(r.source)?.text === r.text.slice(0, 40000) || store.get(r.source)?.text.startsWith(r.text.slice(0, 200)), `${district}: text not cached under the guest link`);
  ok(`fetch_tsba_policy ${district}: ${r.district}, ${r.code} ${r.title}, issued ${r.issued_date}${r.rescinds ? `, rescinds ${r.rescinds.code} of ${r.rescinds.issued}` : ""}`);
}
{
  // A "Mobile" PDF link, read through the same session and pdftotext.
  const r = await call("fetch_tsba_policy", { district: "https://tsbanet.sharepoint.com/:b:/g/IQC4Wb2AeJxPSJ9BcnlRmX-3AcEnCwPd2w15l7PUKVZ-HrE" });
  assert.equal(r.format, "pdf");
  assert.ok(/corporal punishment/i.test(r.text) && r.issued_date && r.rescinds?.issued, "Moore County PDF: text or dates missing");
  ok(`fetch_tsba_policy Moore County PDF link: issued ${r.issued_date}, rescinds ${r.rescinds.code} of ${r.rescinds.issued}`);
}
{
  const f = await failing("fetch_tsba_policy", { district: "Wilson County" });
  assert.match(f.error, /does not host/);
  ok("fetch_tsba_policy: a district TSBA does not host fails with a next step");
}

console.log(`\n${passed} passed`);
