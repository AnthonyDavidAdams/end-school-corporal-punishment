// Arkansas districts must post "State Required Information"; the page carries the board policies or a
// link to them (Simbli, PDFs). Gurdon's superintendent pointed us at it on 2026-09-26.
// For each district: open the site, find the SRI page, collect policy-looking links, write them as
// documents for read-found.mjs. Usage: node ar-sri.mjs in.json out.jsonl
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const [,, IN, OUT] = process.argv;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const targets = JSON.parse(readFileSync(IN, "utf8"));
const browser = await chromium.launch({ headless: true }); const ctx = await browser.newContext({ userAgent: UA });
await ctx.route(/\.(png|jpe?g|gif|svg|woff2?|ttf|mp4)(\?|$)/i, (r) => r.abort());
const out = [];
async function links(page, url) {
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }); await page.waitForTimeout(2500); } catch { return []; }
  return page.$$eval("a[href]", (as) => as.map((a) => ({ h: a.href, t: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100) })));
}
for (const t of targets) {
  const page = await ctx.newPage(); const site = t.website.startsWith("http") ? t.website : "http://" + t.website;
  let root; try { root = new URL(site).origin; } catch { await page.close(); continue; }
  const cands = new Map();
  const home = await links(page, site);
  const sri = home.filter((l) => /state.?required|required.?information|policies|board policy|policy manual/i.test(l.t + " " + l.h)).map((l) => l.h);
  for (const guess of [root + "/page/state-required-information", root + "/o/district/page/state-required-information", root + "/state-required-information"]) sri.push(guess);
  for (const u of [...new Set(sri)].slice(0, 5)) {
    const ls = await links(page, u);
    for (const l of ls) if (/polic|4\.39|corporal|discipline|handbook|simbli|boarddocs|\.pdf/i.test(l.t + " " + l.h) && !/\.(png|jpg)/i.test(l.h)) cands.set(l.h.split("#")[0], l.t);
  }
  await page.close();
  const docs = [...cands].map(([url, title]) => ({ url, title, p: /4\.39|corporal|student discipline|policies|simbli|policy/i.test(title + url) ? 0.9 : 0.6 })).sort((a, b) => b.p - a.p).slice(0, 8);
  out.push({ district: t.name, state: "AR", documents: docs, students: t.students });
  console.log(`  ${docs.length ? "✓" : "·"} ${t.name.slice(0, 34).padEnd(36)} ${docs.length} links ${docs[0] ? docs[0].url.slice(0, 70) : ""}`);
}
await browser.close(); writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join("\n") + "\n"); process.exit(0);
