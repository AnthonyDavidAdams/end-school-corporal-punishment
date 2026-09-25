// Find a district's published email addresses from its own website: the superintendent's if the
// site names one, otherwise the district office's. Public pages only; nothing is guessed.
// Usage: node harvest-emails.mjs targets.json out.jsonl   (targets: [{name,state,website,nces_id?}])
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";
const [,, IN, OUT] = process.argv;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const FOLLOW = /contact|staff|directory|administration|admin|superintendent|district office|central office|board|about|leadership|personnel|employees/i;
const SKIP = /\.(png|jpe?g|gif|svg|pdf|docx?|xlsx?|zip)(\?|$)|facebook|twitter|instagram|youtube|linkedin|mailto:|tel:|javascript:/i;
const targets = JSON.parse(readFileSync(IN, "utf8"));
const done = new Set(existsSync(OUT) ? readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).key) : []);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA }); await ctx.route(/\.(png|jpe?g|gif|svg|woff2?|ttf|mp4)(\?|$)/i, (r) => r.abort());
async function readPage(page, url) {
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }); await page.waitForTimeout(1500); }
  catch { return null; }
  const html = await page.content();
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#64;|&commat;/g, "@").replace(/\s+/g, " ");
  const mailtos = await page.$$eval("a[href^='mailto:']", (as) => as.map((a) => ({ e: a.getAttribute("href").slice(7).split("?")[0], t: (a.closest("li,tr,div,p")?.textContent || "").replace(/\s+/g, " ").slice(0, 200) })));
  const links = await page.$$eval("a[href]", (as) => as.map((a) => ({ h: a.href, t: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80) })));
  return { url: page.url(), text, mailtos, links };
}
for (const t of targets) {
  const key = `${t.state}|${t.name}`; if (done.has(key) || !t.website) continue;
  const page = await ctx.newPage(); const found = new Map(); let pages = 0;
  const site = t.website.startsWith("http") ? t.website : `http://${t.website}`;
  const host = (() => { try { return new URL(site).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const take = (e, context, where) => { e = e.toLowerCase().trim(); if (!/@/.test(e) || /example|sentry|wixpress|\.png$|\.jpg$/.test(e)) return; const prev = found.get(e); found.set(e, { email: e, context: (prev?.context || "") + " | " + context, where }); };
  const home = await readPage(page, site);
  if (home) {
    pages++; for (const m of home.mailtos) take(m.e, m.t, home.url); for (const e of home.text.match(EMAIL) || []) take(e, "", home.url);
    const next = [...new Map(home.links.filter((l) => FOLLOW.test(l.t + " " + l.h) && !SKIP.test(l.h) && (() => { try { return new URL(l.h).hostname.replace(/^www\./, "").endsWith(host) || /site|school|k12|sd\./i.test(l.h); } catch { return false; } })()).map((l) => [l.h.split("#")[0], l])).values()].slice(0, 8);
    for (const l of next) { const p = await readPage(page, l.h); if (!p) continue; pages++; for (const m of p.mailtos) take(m.e, m.t, p.url); for (const e of p.text.match(EMAIL) || []) { const i = p.text.indexOf(e); take(e, p.text.slice(Math.max(0, i - 120), i + 40), p.url); } }
  }
  await page.close();
  const all = [...found.values()];
  const own = all.filter((x) => host && x.email.endsWith("@" + host) || x.email.split("@")[1]?.endsWith(host));
  const pool = own.length ? own : all;
  const sup = pool.find((x) => /superintendent/i.test(x.context)) ?? null;
  const generic = pool.find((x) => /^(info|office|district|admin|contact|webmaster|board|centraloffice)@/i.test(x.email)) ?? null;
  const row = { key, name: t.name, state: t.state, nces_id: t.nces_id ?? null, website: site, pages, superintendent_email: sup?.email ?? null, superintendent_context: sup?.context.slice(0, 160) ?? null, generic_email: generic?.email ?? null, all: pool.map((x) => x.email).slice(0, 12), harvested: new Date().toISOString().slice(0, 10) };
  appendFileSync(OUT, JSON.stringify(row) + "\n");
  console.log(`  ${row.superintendent_email ? "✓" : row.generic_email ? "~" : row.all.length ? "·" : "×"} ${t.state} ${t.name.slice(0, 28).padEnd(30)} ${pages}p  sup=${row.superintendent_email ?? "-"}  generic=${row.generic_email ?? "-"}  (${row.all.length} addresses)`);
}
await browser.close(); process.exit(0);
