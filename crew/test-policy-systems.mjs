// Test for resolve_handbook's policy-system links: the URL parser against every vendor with a reader, then
// resolve_handbook against a stand-in district site. Offline by default; --live also crawls two real
// district sites (Pinellas FL links BoardDocs, Wellington USD 353 KS links KASB).
//
// Usage: node crew/test-policy-systems.mjs [--live]
import assert from "node:assert/strict";
import { policySystem, registerTools } from "./tools.mjs";
import { tsbaTarget } from "./readers/tsba.mjs";

let passed = 0;
const ok = (name) => { passed++; console.log(`ok - ${name}`); };
const sys = (url) => policySystem(url)?.[1] ?? null;
const args = (url) => sys(url)?.arguments ?? null;

// ---- the parser ----
assert.deepEqual(args("https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36031758"), { site: "36031758" });
assert.equal(sys("https://simbli.eboardsolutions.com/Index.aspx"), null);
assert.deepEqual(args("https://pol.tasb.org/Policy/Code/1133?filter=FO"), { district_key: "1133" });
assert.deepEqual(args("https://pol.tasb.org/PolicyOnline/PolicyDetails?key=1133&code=FO"), { district_key: "1133" });
ok("Simbli and TASB, as before");

assert.deepEqual(sys("https://go.boarddocs.com/fl/pcsfl/Board.nsf/Public"), { vendor: "BoardDocs", site: "fl/pcsfl", read_with: "fetch_boarddocs_policy", arguments: { site: "fl/pcsfl" } });
assert.deepEqual(args("https://go.boarddocs.com/fl/pcsfl/Board.nsf/goto?open&id=CRYLCC542E75"), { site: "fl/pcsfl" });
assert.deepEqual(args("https://go.boarddocs.com/FLA/vcsfl/Board.nsf/vpublic?open"), { site: "fla/vcsfl" });
assert.deepEqual(args("https://www.boarddocs.com/tn/scsk12/Board.nsf/Public"), { site: "tn/scsk12" });
assert.deepEqual(args("https://go.boarddocs.com/ms/desoto"), { site: "ms/desoto" });
assert.equal(policySystem("https://go.boarddocs.com/fl/pcsfl/Board.nsf/Public")[0], policySystem("https://go.boarddocs.com/fl/pcsfl/Board.nsf/goto?open&id=X")[0]);
for (const u of ["https://www.boarddocs.com/", "https://www.boarddocs.com/about", "https://go.boarddocs.com/login/help/page.html", "https://notboarddocs.com/fl/pcsfl/Board.nsf/Public"]) assert.equal(sys(u), null, u);
ok("BoardDocs: <state>/<site> from Public, goto and vpublic links; vendor pages ignored");

assert.deepEqual(sys("https://nlrsd.diligent.community/Portal/Policy.aspx"), { vendor: "Diligent Community", tenant: "nlrsd", read_with: "fetch_diligent_policy", arguments: { tenant: "nlrsd" } });
assert.deepEqual(args("https://bentonvillek12.community.diligentoneplatform.com/document/0f8c2a8e-1111-2222-3333-444455556666/"), { tenant: "bentonvillek12" });
assert.deepEqual(args("https://Greenville-SC.community.highbond.com/Portal/"), { tenant: "greenville-sc" });
for (const u of ["https://www.diligent.com/", "https://diligent.community/"]) assert.equal(sys(u), null, u);
ok("Diligent: tenant from all three hostnames; Diligent's own site ignored");

assert.deepEqual(sys("https://app.forethoughtconsulting.com/kb/lincoln-parish-school-board/manual?doc=42"), { vendor: "Forethought CAPS", slug: "lincoln-parish-school-board", read_with: "fetch_forethought_policy", arguments: { kb: "lincoln-parish-school-board" } });
const caps = sys("https://caps.forethoughtconsulting.com/kb/8d6f3c1e-0000-4000-8000-123456789abc");
assert.equal(caps.slug, null); assert.equal(caps.arguments, null); assert.match(caps.note, /app\.forethoughtconsulting\.com\/kb\//);
for (const u of ["https://forethoughtconsulting.com/", "https://app.forethoughtconsulting.com/login"]) assert.equal(sys(u), null, u);
ok("Forethought: kb slug; older caps uuid noted rather than handed to the reader");

assert.deepEqual(sys("https://policy.kasb.org/Kansas/browse/Wellingtonusd353/Wellingtonusd353/sop0000168898"), { vendor: "KASB Policy Online", showset: "Wellingtonusd353", read_with: "fetch_kasb_policy", arguments: { showset: "Wellingtonusd353" } });
assert.equal(policySystem("https://policy.kasb.org/kansas/browse/Wellingtonusd353")[0], policySystem("https://policy.kasb.org/Kansas/browse/Wellingtonusd353/Wellingtonusd353/sop1")[0]);
for (const u of ["https://policy.kasb.org/", "https://www.kasb.org/kansas/browse/Udallusd463"]) assert.equal(sys(u), null, u);
ok("KASB: ShowSet from browse links, one entry per ShowSet");

const manual = "https://tsba.net/henry-county-board-of-education-policy-manual/";
assert.deepEqual(sys("http://www.tsba.net/henry-county-board-of-education-policy-manual/#6"), { vendor: "TSBA (Tennessee School Boards Association)", manual, read_with: "fetch_tsba_policy", arguments: { district: manual } });
assert.deepEqual(args("https://tsbanet.sharepoint.com/:w:/g/EXAMPLE123"), { district: "https://tsbanet.sharepoint.com/:w:/g/EXAMPLE123" });
assert.equal(sys("https://tsbanet-my.sharepoint.com/:b:/g/personal/x/EXAMPLE").guest_link, "https://tsbanet-my.sharepoint.com/:b:/g/personal/x/EXAMPLE");
assert.deepEqual(tsbaTarget("tsba.net/lexington-board-of-education-policy-manual"), { manual: "https://tsba.net/lexington-board-of-education-policy-manual/" });
for (const u of ["https://tsba.net/about/", "https://othertsba.net/x-policy-manual/", "https://contoso.sharepoint.com/:w:/g/X"]) assert.equal(sys(u), null, u);
ok("TSBA: manual pages and guest links");

assert.deepEqual(sys("https://boardpolicyonline.com/?b=greene"), { vendor: "BoardPolicyOnline (MicroScribe)", board: "greene", read_with: "fetch_boardpolicyonline_policy", arguments: { board: "greene" } });
assert.deepEqual(args("https://boardpolicyonline.com/bl/?b=florence&s=12345"), { board: "florence", section: "12345" });
assert.deepEqual(args("https://v3.boardpolicyonline.com/b/warren/s/186803"), { board: "warren", section: "186803" });
assert.deepEqual(args("https://boardpolicyonline.com/?b=greene#&&hs=2099104"), { board: "greene", section: "2099104" });
for (const u of ["https://boardpolicyonline.com/", "https://example.com/?b=greene"]) assert.equal(sys(u), null, u);
ok("BoardPolicyOnline: board key and section from legacy, /bl/, v3 and #hs links");

for (const u of ["https://www.district.example/handbook.pdf", "mailto:board@district.example", "not a url"]) assert.equal(policySystem(u), null, u);
ok("anything else is not a policy system");

// ---- resolve_handbook against a stand-in district ----
const z = new Proxy(function () {}, { get: () => z, apply: () => z });
const text = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const fail = (msg, extra = {}) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error: msg, ...extra }) }] });
const pad = `<p>${"District news and events. ".repeat(260)}</p>`;
const a = (href, label) => `<a href="${href}">${label}</a>`;
const pages = {
  "https://district.example/": pad + [
    a("https://go.boarddocs.com/fl/pcsfl/Board.nsf/Public", "Board Policies"),
    a("https://go.boarddocs.com/fl/pcsfl/Board.nsf/goto?open&amp;id=CRYLCC542E75", "Policy 5500.07"),
    a("https://nlrsd.diligent.community/Portal/Policy.aspx", "Policies (Diligent)"),
    a("https://app.forethoughtconsulting.com/kb/lincoln-parish-school-board", "Policy manual"),
    a("https://policy.kasb.org/Kansas/browse/Wellingtonusd353/Wellingtonusd353/sop0000168898", "<span>KASB Policy</span>"),
    a("https://tsba.net/henry-county-board-of-education-policy-manual/", "TSBA manual"),
    a("https://tsbanet.sharepoint.com/:w:/g/BUDGET", "2.100 Budget"),
    a("https://tsbanet.sharepoint.com/:w:/g/CP6314", "6.314 Corporal Punishment"),
    a("https://boardpolicyonline.com/?b=greene&amp;s=2099104", "Board Policy Online"),
    a("https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36031758", "Simbli"),
    a("/files/2026-27-student-handbook.pdf", "2026-27 Student Handbook"),
  ].join("\n"),
  "https://onlypolicy.example/": pad + a("https://caps.forethoughtconsulting.com/kb/8d6f3c1e-0000-4000-8000-123456789abc", "Policies") + a("https://policy.kasb.org/kansas/browse/Holtonusd336", "Board Policy"),
};
const fetchImpl = async (url) => {
  const body = pages[url];
  const res = new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
  Object.defineProperty(res, "url", { value: url });
  return res;
};
const handlers = new Map();
await registerTools({ registerTool: (name, _def, fn) => handlers.set(name, fn) }, { fetchImpl, crew: { crew: { document_terms: ["corporal punishment"] } } }, { z, text, fail, documents: null });
const resolve = async (input) => JSON.parse((await handlers.get("resolve_handbook")(input)).content[0].text);

{
  const r = await resolve({ website: "https://district.example/", max_pages: 1 });
  const by = Object.fromEntries(r.board_policy_systems.map((s) => [s.read_with, s]));
  assert.equal(r.board_policy_systems.length, 8, JSON.stringify(r.board_policy_systems.map((s) => s.arguments)));
  assert.deepEqual(by.fetch_boarddocs_policy, { vendor: "BoardDocs", site: "fl/pcsfl", read_with: "fetch_boarddocs_policy", arguments: { site: "fl/pcsfl" }, found_on: "https://district.example/", link_text: "Board Policies" });
  assert.equal(by.fetch_diligent_policy.tenant, "nlrsd");
  assert.equal(by.fetch_forethought_policy.slug, "lincoln-parish-school-board");
  assert.equal(by.fetch_kasb_policy.showset, "Wellingtonusd353");
  assert.equal(by.fetch_kasb_policy.link_text, "KASB Policy");
  assert.deepEqual(by.fetch_boardpolicyonline_policy.arguments, { board: "greene", section: "2099104" });
  assert.equal(by.fetch_simbli_policy.site, "36031758");
  const tsba = r.board_policy_systems.filter((s) => s.read_with === "fetch_tsba_policy");
  assert.deepEqual(tsba.map((s) => s.manual ?? s.guest_link), ["https://tsba.net/henry-county-board-of-education-policy-manual/", "https://tsbanet.sharepoint.com/:w:/g/CP6314"]);
  assert.equal(r.candidates[0]?.url, "https://district.example/files/2026-27-student-handbook.pdf");
  assert.match(r.next, /^Pass the newest candidate to fetch_document\..* also publishes board policy through BoardDocs and .*Call fetch_boarddocs_policy with \{"site":"fl\/pcsfl"\}\./);
  ok("resolve_handbook: every vendor linked, one entry per district system, irrelevant TSBA guest link dropped, next names the reader");
}
{
  const r = await resolve({ website: "https://onlypolicy.example/", max_pages: 1 });
  assert.equal(r.candidates.length, 0);
  assert.equal(r.board_policy_systems.length, 2);
  assert.match(r.next, /^No handbook file, but this district publishes board policy through Forethought CAPS and KASB Policy Online\. Call fetch_kasb_policy with \{"showset":"Holtonusd336"\}\./);
  ok("resolve_handbook: no handbook, so next points at the first system it can call");
}
{
  const r = await resolve({ website: "https://go.boarddocs.com/fla/vcsfl/Board.nsf/Public" });
  assert.equal(r.board_policy_system.site, "fla/vcsfl");
  assert.match(r.next, /Call fetch_boarddocs_policy with \{"site":"fla\/vcsfl"\}\./);
  const s = await resolve({ website: "https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=4052" });
  assert.match(s.next, /Call fetch_simbli_policy with \{"site":"4052"\}\./);
  const none = await resolve({ website: "https://simbli.eboardsolutions.com/" });
  assert.match(none.next, /carries no S= district key/);
  ok("resolve_handbook: a vendor URL given as the website is handed straight to its reader");
}

// ---- live ----
if (process.argv.includes("--live")) {
  const live = new Map();
  await registerTools({ registerTool: (name, _def, fn) => live.set(name, fn) }, { fetchImpl: fetch, crew: { crew: { document_terms: ["corporal punishment"] } } }, { z, text, fail, documents: null });
  for (const [label, website, readWith, want] of [
    ["Pinellas FL", "https://www.pcsb.org/", "fetch_boarddocs_policy", { site: "fl/pcsfl" }],
    ["Wellington USD 353 KS", "https://www.usd353.com/", "fetch_kasb_policy", { showset: "Wellingtonusd353" }],
  ]) {
    const r = JSON.parse((await live.get("resolve_handbook")({ website, max_pages: 1 })).content[0].text);
    if (!r.pages_examined) { console.log(`skip - ${label}: ${website} served nothing to this address`); continue; }
    const s = r.board_policy_systems.find((x) => x.read_with === readWith);
    assert.ok(s, `${label}: no ${readWith} entry in ${JSON.stringify(r.board_policy_systems)}`);
    assert.deepEqual(s.arguments, want);
    ok(`live resolve_handbook ${label}: ${s.vendor} ${JSON.stringify(s.arguments)} via "${s.link_text}" on ${s.found_on}`);
  }
}

console.log(`\n${passed} passed`);
