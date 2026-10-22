// Live test for the vendor readers in crew/: fetch_simbli_policy and fetch_boardpolicyonline_policy.
//
// Loads crew/tools.mjs the way the server does, with a stand-in server and document cache, and reads real
// districts. It talks to the vendors, so it is slow (Simbli is paced at one request per three seconds, a
// BoardPolicyOnline search takes about half a minute) and it is not part of `npm test`. Simbli's bot
// protection blocks an address that has been probing it hard; the test says so rather than failing quietly.
//
// Usage: node tools/test-readers.mjs [simbli|bpo]      (needs `npm install` in mcp/ for zod)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { z } = createRequire(join(root, "mcp", "package.json"))("zod");
const { registerTools } = await import(join(root, "crew", "tools.mjs"));

const tools = {};
const server = { registerTool: (name, _def, fn) => { tools[name] = fn; } };
const store = new Map();
const documents = { put: (url, text, meta) => store.set(url, { text, ...meta }), read: (url) => store.get(url) ?? null };
const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
const fail = (error, extra) => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error, ...extra }) }] });
await registerTools(server, { crew: { crew: { document_terms: ["corporal punishment"] } } }, { z, text, fail, documents });

const call = async (name, args) => {
  const r = await tools[name](args);
  const out = JSON.parse(r.content[0].text);
  assert.ok(!r.isError, `${name} ${JSON.stringify(args)}: ${out.error}`);
  return out;
};
const only = process.argv[2];
let passed = 0, failed = 0;
const check = async (label, fn) => {
  try { console.log(`ok - ${label}: ${await fn()}`); passed++; }
  catch (err) { console.log(`not ok - ${label}: ${err.message}`); failed++; }
};
const mentions = (s) => /corporal punishment/i.test(s);

if (!only || only === "simbli") {
  // Policies that came back with dates and no text before: one-sentence Georgia bans that were never
  // cached, Yazoo City, and Kansas City, whose policy is in its second manual.
  const simbli = [
    ["City Schools of Decatur GA", "4052", "JDA"],
    ["Calhoun City GA", "4023", "JDA"],
    ["Oglethorpe County GA", "4124", "JDA"],
    ["Yazoo City MS", "36031810", "JDB"],
    ["Kansas City Public Schools MO", "228", "JGA-2"],
  ];
  for (const [name, site, code] of simbli) {
    await check(`simbli ${name} ${code}`, async () => {
      const out = await call("fetch_simbli_policy", { site, code });
      const p = out.policies?.[0];
      assert.ok(p, `no policy ${code} in an index of ${out.policies_in_index}`);
      assert.ok(!p.error, p.error);
      assert.ok(mentions(p.text), `text of ${p.chars} characters does not mention corporal punishment`);
      return `${p.chars} chars, revised ${p.last_revised}, adopted ${p.originally_adopted}${p.manual ? `, manual "${p.manual}"` : ""}`;
    });
  }

  // The shell page fetch_document caches under the same URL must not be served as the policy.
  await check("simbli ignores a cached shell page", async () => {
    const first = await call("fetch_simbli_policy", { site: "4052", code: "JDA" });
    const url = first.policies[0].url;
    store.set(url, { text: "Skip to Main Menu Skip to Main Content Skip to Footer ... Back to Top", content_type: "text/html" });
    const again = await call("fetch_simbli_policy", { site: "4052", code: "JDA" });
    assert.ok(mentions(again.policies[0].text), "served the cached shell");
    assert.equal(store.get(url).extracted_by, "simbli-api", "did not overwrite the shell");
    return "re-read from Simbli and overwrote the shell";
  });

  await check("simbli flags the 01/01/1999 placeholder (Amory MS JDB)", async () => {
    const p = (await call("fetch_simbli_policy", { site: "36031679", code: "JDB" })).policies[0];
    assert.equal(p.originally_adopted, "01/01/1999");
    assert.ok(p.warnings?.some((w) => w.startsWith("originally_adopted is 01/01/1999")), "no placeholder warning");
    assert.ok(mentions(p.text));
    return `warned; last_revised ${p.last_revised}`;
  });
}

if (!only || only === "bpo") {
  const bpo = [
    ["Greene County NC", "greene", "4300", "July 19, 2010", true],
    ["Warren County NC", "warren", "4302", "September 8, 2008", true],
    ["Hampton SC", "hampton_consolidated", "JKA", "10/3/23", true],
    ["Clarendon SC", "clarendon_county", "JKA", "5/2/22", true],
    // Florence 1's only match is a statute in the legal references of its bullying policy.
    ["Florence 1 SC", "florence", "JICFAA", "11/06", false],
  ];
  for (const [name, board, code, adopted, rule] of bpo) {
    await check(`boardpolicyonline ${name}`, async () => {
      const out = await call("fetch_boardpolicyonline_policy", { board, query: "corporal punishment", max_policies: 2 });
      const p = out.policies?.find((x) => x.code === code);
      assert.ok(p, `no ${code} among ${out.hits?.map((h) => h.code).join(", ") || "no hits"}`);
      assert.equal(p.adopted, adopted);
      assert.ok(mentions(p.text), "text does not mention corporal punishment");
      if (rule) assert.ok(p.hits.length, "no passage");
      assert.equal(store.get(p.url)?.extracted_by, "boardpolicyonline-blazor", "text not cached under the citable URL");
      return `${p.code} ${p.url}, adopted ${p.adopted}, last revised ${p.last_revised ?? "none"}, ${p.chars} chars`;
    });
  }
  await check("boardpolicyonline reads a section by number", async () => {
    store.delete("https://v3.boardpolicyonline.com/b/greene/s/2099104");
    const out = await call("fetch_boardpolicyonline_policy", { board: "greene", section: "2099104" });
    const p = out.policies[0];
    assert.equal(p.code, "4300");
    assert.ok(mentions(p.text));
    return `${p.title}`;
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
