// Offline test for fetch_simbli_policy: the reader against a stand-in Simbli that answers the way the real
// API does, so the logic can be checked from an address Simbli's bot protection has blocked.
//
// Covers a second manual reached by policy type, a policy uploaded as a PDF, a one-sentence body, a cached
// copy of the page shell under the policy's URL, the 01/01/1999 placeholder, a body that does not match its
// title, and an empty body. Takes about thirty seconds: the reader's three-second pacing still applies.
//
// Usage: node tools/test-simbli-offline.mjs      (needs `npm install` in mcp/ for zod, and poppler's pdftotext)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { z } = createRequire(join(root, "mcp", "package.json"))("zod");
const { registerTools } = await import(join(root, "crew", "tools.mjs"));

function onePagePdf(line) {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const policy = (ID, Code, Description, LastRevisedDate, OriginalAdoptedDate) => ({ ID, StatusStr: "ADOPTED", Policy: { Code, Description, LastRevisedDate, OriginalAdoptedDate } });
const html = (content) => ({ PolicyRevision: { Content: content, Policy: { ContentType: { DataTypeID: 1 } } } });
const listings = {
  "": { PolicyTypes: [{ Value: "A", Text: "Governance Manual" }, { Value: "B", Text: "Board Policy Manual" }], SelectedPolicyTypeID: "A",
    PolicyListingDTO: { PolicySections: [{ Name: "Ends" }], Policies: [policy("r1", "1.0", "Ends", "04/27/2022", "06/22/2011")] } },
  B: { PolicyListingDTO: { PolicySections: [{ Name: "J. Students" }], Policies: [
    policy("r2", "JGA-2", "Corporal Punishment", "03/16/2026", "01/01/1999"),
    policy("r3", "BCBK-E(1)", "Corporal Punishment Exhibit", "07/21/2015", "09/23/2003"),
    policy("r4", "JDA", "Corporal Punishment", "01/10/2023", "01/10/2023"),
    policy("r5", "JDB", "Corporal Punishment", "03/15/1994", "03/15/1994"),
    policy("r6", "JDC", "Corporal Punishment", "06/07/2011", "06/07/2011"),
  ] } },
};
const views = {
  r2: html("<p>Corporal punishment shall not be administered.</p>"),
  r3: { PolicyRevision: { Content: "", PDFFilePath: "%2FSB_Assets%2FPolicies%2Fexhibit.pdf", Policy: { ContentType: { DataTypeID: 2 } } } },
  r4: html("<p>Corporal punishment is not used in this district.</p>"),
  r5: html(`<p>${"The district will identify homeless children and youth and remove barriers to their enrollment. ".repeat(4)}</p>`),
  r6: html(""),
};
const PDF = onePagePdf("Corporal punishment is not permitted in this district.");
const fetchImpl = async (url) => {
  const u = new URL(url);
  const ok = (body, type) => new Response(body, { status: 200, headers: { "content-type": type } });
  if (u.pathname === "/Policy/PolicyListing.aspx") return ok("<script>var sToken = 'T'; var enSID = 'E';</script>", "text/html");
  if (u.pathname === "/Services/api/PolicyListing/") return ok(JSON.stringify(listings[u.searchParams.get("ptid")] ?? {}), "application/json");
  if (u.pathname === "/Services/api/ViewPolicy/GetViewPolicyData") return ok(JSON.stringify(views[u.searchParams.get("revid")]), "application/json");
  if (u.pathname === "/SB_Assets/Policies/exhibit.pdf") return ok(PDF, "application/pdf");
  return new Response("not found", { status: 404 });
};

const tools = {};
const store = new Map();
const documents = { put: (url, text, meta) => store.set(url, { text, ...meta }), read: (url) => store.get(url) ?? null };
const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
const fail = (error) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error }) }] });
await registerTools({ registerTool: (name, _def, fn) => { tools[name] = fn; } }, { fetchImpl, crew: { crew: { document_terms: ["corporal punishment"] } } }, { z, text, fail, documents });

const SITE = "999";
const url = (revid) => `https://simbli.eboardsolutions.com/Policy/ViewPolicy.aspx?S=${SITE}&revid=${revid}`;
store.set(url("r4"), { text: `Skip to Main Menu Skip to Main Content ${" ".repeat(1000)} Back to Top`, content_type: "text/html" });
const read = async (code) => (JSON.parse((await tools.fetch_simbli_policy({ site: SITE, code })).content[0].text)).policies[0];

const index = JSON.parse((await tools.fetch_simbli_policy({ site: SITE, full_index: true, terms: ["none"] })).content[0].text);
assert.equal(index.policies_in_index, 6, "the second manual was not indexed");
assert.ok(index.sections.includes("Board Policy Manual: J. Students"));
console.log("ok - both manuals indexed");

let p = await read("JGA-2");
assert.equal(p.manual, "Board Policy Manual");
assert.ok(p.warnings?.[0]?.startsWith("originally_adopted is 01/01/1999"));
console.log("ok - 01/01/1999 flagged");

p = await read("BCBK-E(1)");
assert.equal(p.text, "Corporal punishment is not permitted in this district.");
assert.equal(p.pdf, "https://simbli.eboardsolutions.com/SB_Assets/Policies/exhibit.pdf");
assert.equal(store.get(url("r3")).extracted_by, "simbli-pdf");
console.log("ok - PDF policy read and cached");

p = await read("JDA");
assert.equal(p.text, "Corporal punishment is not used in this district.");
assert.equal(store.get(url("r4")).extracted_by, "simbli-api", "the cached shell was not replaced");
console.log("ok - cached shell ignored; one-sentence body cached");

p = await read("JDB");
assert.ok(p.warnings?.some((w) => w.startsWith("The text never mentions")));
console.log("ok - body that does not match its title flagged");

p = await read("JDC");
assert.equal(p.chars, 0);
assert.ok(p.warnings?.some((w) => w.startsWith("Simbli served this policy's index entry and dates but an empty body")));
assert.ok(!store.has(url("r6")), "an empty body was cached");
console.log("ok - empty body flagged and not cached");
