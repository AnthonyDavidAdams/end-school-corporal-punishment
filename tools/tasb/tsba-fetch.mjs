// Fetch TSBA (Tennessee School Boards Association) policy PDFs from their SharePoint share links.
// tsba.net itself answers 403 to every automated browser, so the links come from a person's Chrome
// (the manual page lists "6.314 Corporal Punishment" with a :b: link). The share link, opened once
// in a browser context, then answers `?download=1` with the PDF bytes.
// Usage: node tsba-fetch.mjs links.json out.jsonl   (links: [{district, url, state?}])
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
const [,, IN, OUT] = process.argv;
const ANCH = /corporal punishment|corporal|paddl|spank|swat|licks/i;
const NOT = ["physical restraint", "restraint and seclusion", "seclusion", "mechanical restraint", "chemical restraint", "self-defense", "imminent bodily harm"];
const clip = (t) => t.split(/(?<=[.:;])\s+/).map((s) => s.replace(/\s+/g, " ").trim().replace(/^.*?Board of Education\s+(?=[A-Z])/, "").replace(/^(Corporal Punishment|Descriptor Term:)\s+/, "")).filter((s) => s.length > 30 && s.length < 600 && ANCH.test(s) && !NOT.some((n) => s.toLowerCase().includes(n)));
const links = JSON.parse(readFileSync(IN, "utf8"));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" });
const page = await ctx.newPage();
const rows = [];
for (const l of links) {
  let text = "", how = "";
  try {
    await page.goto(l.url, { waitUntil: "domcontentloaded", timeout: 60_000 }); await page.waitForTimeout(3000);
    const r = await ctx.request.get(l.url + "?download=1", { timeout: 90_000 }); const body = await r.body();
    if (body.subarray(0, 5).toString() === "%PDF-") { writeFileSync("/tmp/tsba.pdf", body); text = execFileSync("pdftotext", ["/tmp/tsba.pdf", "-"]).toString(); how = "pdf";
      // TSBA pages carry margin line numbers and a header block (code, dates, "Monitoring:") that
      // pdftotext runs into the first sentence; strip them so the clip is the policy text alone.
      text = text.replace(/^\s*\d{1,3}\s*$/gm, "").replace(/^\s*\d{1,3}\s+(?=[A-Z(])/gm, "")
        .replace(/^(Monitoring:|Review:|Descriptor (Term|Code):|Issued Date:|Rescinds:|Issued:|Corporal Punishment|\d\.\d{3}|\d{2}\/\d{2}\/\d{2,4}|in March|Annually,?)\s*$/gm, "")
        .replace(/\bReview:\s*Annually,?\s*(in March)?\s*(\d{4})?\s*/g, " ").replace(/\bAnnually,\s*(\d{4}\s*)?/g, " "); }
    else how = `not pdf (${r.status()}, ${body.length}b)`;
  } catch (e) { how = "error: " + String(e.message).slice(0, 60); }
  const c = clip(text);
  const issued = text.match(/(\d{2}\/\d{2}\/\d{2,4})/)?.[1] ?? null;
  rows.push({ site: null, district: l.district, _state: l.state ?? "TN", verdict: c.length ? "rule" : (how === "pdf" ? "silent" : "unreadable"), how,
    policies: c.length ? [{ code: "6.314", title: "Corporal Punishment (TSBA policy manual)", url: l.url, candidates: c.slice(0, 40), last_revised: issued }] : [] });
  console.log(`  ${c.length ? "✓" : "·"} ${l.district.padEnd(24)} ${how.padEnd(12)} ${text.length.toLocaleString().padStart(7)} chars ${c.length} sentences  issued ${issued ?? "?"}`);
}
await browser.close();
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
process.exit(0);
