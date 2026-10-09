// Open every NC record's source page live and check it says what the record says it says:
// the heading carries the recorded policy code and every quoted sentence is on the page verbatim.
//   node tools/nc/_verify.mjs [out/ncsba-nc-records.json] [--names "A|B|C"]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "out/ncsba-nc-records.json";
let recs = JSON.parse(readFileSync(file, "utf8"));
const names = arg("names", null); if (names) recs = recs.filter((r) => names.split("|").includes(r.name));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA });
let i = 0, bad = 0;
const norm = (s) => s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
async function worker() {
  const page = await ctx.newPage();
  for (;;) {
    const r = recs[i++]; if (!r) break;
    try {
      await page.goto(r.source, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForFunction(() => (document.querySelector(".policy-content-content")?.innerText || "").length > 50, null, { timeout: 45_000 }).catch(() => {});
      const h1 = await page.evaluate(() => document.querySelector("#policy-content-title")?.textContent?.trim() || "");
      const text = norm(await page.evaluate(() => document.querySelector(".policy-content-content")?.innerText || ""));
      const title = await page.title();
      const codeOk = h1.includes(r.policy_code), leadOk = text.includes(norm(r.quote)), allOk = r.quotes.every((q) => text.includes(norm(q)));
      const ok = codeOk && leadOk && allOk; if (!ok) bad++;
      console.log(`${ok ? "ok " : "BAD"} ${r.name} | ${r.status} | ${r.policy_code} | ${r.source}\n    book: ${title} | page: ${h1.slice(0, 70)} | code ${codeOk} lead ${leadOk} all ${r.quotes.length} ${allOk}`);
      if (names) { const k = text.indexOf(norm(r.quote)); console.log(`    context: ...${text.slice(Math.max(0, k - 100), k + norm(r.quote).length + 50)}...`); }
    } catch (e) { bad++; console.log(`BAD ${r.name} | ${r.source} | ${String(e.message || e).slice(0, 80)}`); }
  }
  await page.close();
}
await Promise.all(Array.from({ length: 3 }, worker));
await browser.close();
console.log(`${recs.length} records checked, ${bad} bad`);
process.exit(bad ? 1 : 0);
