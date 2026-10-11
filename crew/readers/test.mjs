// Live test of the policy readers against real districts. Needs the network; takes two to three minutes.
//
//   node crew/readers/test.mjs [boarddocs|diligent|forethought ...]
//
// PDF extraction is the engine's, so this loads Ground Crew's DocumentCache: from GROUNDCREW_DIR, else a
// groundcrew checkout beside this repository, else an installed @earthpilot/groundcrew.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerTools } from "../tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

async function loadDocumentCache() {
  const candidates = [process.env.GROUNDCREW_DIR, resolve(repo, "../groundcrew"), resolve(repo, "node_modules/@earthpilot/groundcrew")].filter(Boolean);
  for (const dir of candidates) {
    const file = join(dir, "server/documents.mjs");
    if (existsSync(file)) return (await import(pathToFileURL(file).href)).DocumentCache;
  }
  throw new Error(`Ground Crew's server/documents.mjs not found; set GROUNDCREW_DIR to a groundcrew checkout with its dependencies installed. Tried: ${candidates.join(", ")}`);
}

// The handlers are called directly, so the schema builder only has to accept the calls made on it.
const z = new Proxy(function () {}, { get: () => z, apply: () => z });
const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (msg, extra) => ({ content: [{ type: "text", text: extra ? `${msg}\n${JSON.stringify(extra, null, 2)}` : msg }], isError: true });

const DocumentCache = await loadDocumentCache();
const documents = new DocumentCache({ dir: mkdtempSync(join(tmpdir(), "escp-readers-")) });
const handlers = new Map();
const server = { registerTool: (name, _def, fn) => handlers.set(name, fn) };
const ctx = { fetchImpl: fetch, crewDir: join(repo, "crew"), crew: { crew: { document_terms: ["corporal punishment", "paddl"] } } };
const names = await registerTools(server, ctx, { z, text, fail, documents });
for (const n of ["fetch_boarddocs_policy", "fetch_diligent_policy", "fetch_forethought_policy"]) {
  assert.ok(names.includes(n) && handlers.has(n), `${n} is not registered`);
}

const call = async (name, args) => {
  const r = await handlers.get(name)(args);
  const body = r.content[0].text;
  if (r.isError) throw new Error(`${name} failed: ${body.slice(0, 600)}`);
  return JSON.parse(body);
};
const CP = /corporal punishment/i;
// Whatever a finding would cite must already be in the cache, holding the phrase the quote would carry.
const cachedHas = (url) => CP.test(documents.read(url)?.text ?? "");

const cases = {
  boarddocs: [
    ["Pinellas FL (fl/pcsfl), default search", async () => {
      const r = await call("fetch_boarddocs_policy", { site: "https://go.boarddocs.com/fl/pcsfl/Board.nsf/Public" });
      assert.ok(r.search.policy_results.length > 0, "search found no policies");
      const p = r.policies.find((x) => x.code === "5500.07" && x.hits.some((h) => CP.test(h.context)));
      assert.ok(p, `5500.07 (K-12 discipline) not read with a corporal punishment passage; read ${r.policies.map((x) => x.code).join(", ")}`);
      assert.ok(p.adopted && p.last_revised, "dates missing");
      assert.ok(cachedHas(p.cite), "cite not cached");
      return `${p.code} ${p.title}, revised ${p.last_revised}`;
    }],
    ["Hendry FL (bare site + state), default", async () => {
      const r = await call("fetch_boarddocs_policy", { site: "hendry", state: "FL" });
      assert.equal(r.site, "fl/hendry");
      const p = r.policies.find((x) => x.hits.some((h) => CP.test(h.context)));
      assert.ok(p, "no corporal punishment passage");
      return `${p.code} ${p.title}, revised ${p.last_revised}`;
    }],
    ["Memphis-Shelby TN (tn/scsk12) policy 6022, PDF attachment", async () => {
      const r = await call("fetch_boarddocs_policy", { site: "tn/scsk12", code: "6022" });
      const p = r.policies[0];
      assert.equal(p.code, "6022");
      const a = p.attachments?.find((x) => x.hits?.some((h) => CP.test(h.context)));
      assert.ok(a, "attachment has no corporal punishment passage");
      assert.equal(p.cite, a.url);
      assert.ok(cachedHas(p.cite), "cite not cached");
      return `${p.title}, revised ${p.last_revised}, cite ${p.cite}`;
    }],
    ["Volusia FL (site 'vcsfl' + state FL resolves to fla/) policy 208", async () => {
      const r = await call("fetch_boarddocs_policy", { site: "vcsfl", state: "FL", code: "208" });
      assert.equal(r.site, "fla/vcsfl");
      const hit = r.policies.find((p) => p.attachments?.some((a) => a.hits?.some((h) => CP.test(h.context))));
      assert.ok(hit, "no 208 attachment mentions corporal punishment");
      return `${hit.code} ${hit.title}, revised ${hit.last_revised}`;
    }],
    ["Orange FL (fla/orcpsfl): no policy book, said plainly", async () => {
      const r = await call("fetch_boarddocs_policy", { site: "fla/orcpsfl" });
      assert.equal(r.policies_in_index, 0);
      assert.ok(r.no_policy_book);
      return `${r.search?.other_results_total ?? 0} meeting documents mention it; no policy book`;
    }],
  ],
  diligent: [
    ["North Little Rock AR (nlrsd) 4.39", ["nlrsd.diligent.community", "4.39"]],
    ["Bentonville AR (bentonvillek12) 4.39", ["https://bentonvillek12.community.diligentoneplatform.com/Portal/Policy.aspx", "4.39"]],
    ["Greenville SC (greenville-sc) JD", ["greenville-sc", "JD"]],
    ["Okaloosa FL (okaloosaschools) 04-32", ["okaloosaschools", "04-32"]],
  ].map(([label, [tenant, code]]) => [label, async () => {
    const r = await call("fetch_diligent_policy", { tenant, code });
    const p = r.policies.find((x) => x.hits.some((h) => CP.test(h.context)));
    assert.ok(p, `no ${code} text mentions corporal punishment (${r.policies.map((x) => x.error ?? `${x.chars} chars`).join("; ")})`);
    assert.ok(cachedHas(p.url), "document URL not cached");
    return `${p.code} ${p.title}, adopted ${p.adopted ?? "?"}, revised ${p.revised?.at(-1) ?? "?"}`;
  }]),
  forethought: [
    ["Lincoln Parish LA JDA", ["lincoln-parish-school-board", "JDA"]],
    ["East Baton Rouge LA JDA", ["https://app.forethoughtconsulting.com/kb/east-baton-rouge-parish-school-board", "JDA"]],
    ["St. Tammany LA, default text search", ["st-tammany-parish-school-board", undefined]],
  ].map(([label, [kb, code]]) => [label, async () => {
    const r = await call("fetch_forethought_policy", { kb, code });
    const p = r.policies.find((x) => x.hits.some((h) => CP.test(h.context)));
    assert.ok(p, "no corporal punishment passage");
    assert.ok(cachedHas(p.url), "doc URL not cached");
    return `${p.title}, latest revised ${p.latest_revised ?? "?"} (${r.policies_in_manual} policies)`;
  }]),
};

const only = process.argv.slice(2);
let passed = 0, failed = 0;
for (const [group, list] of Object.entries(cases)) {
  if (only.length && !only.includes(group)) continue;
  for (const [label, fn] of list) {
    const t0 = Date.now();
    try { const note = await fn(); passed++; console.log(`ok - ${group}: ${label} -- ${note} (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
    catch (err) { failed++; console.log(`not ok - ${group}: ${label} -- ${err.message}`); }
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
