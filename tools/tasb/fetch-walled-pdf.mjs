// Fetch a PDF from behind a bot challenge.
//
// curl through the proxy gets the challenge HTML, not the file. A browser can visit the site's front
// page, satisfy the challenge and be given a cookie; a request made through that same browser context
// then carries the cookie and gets the bytes. Nineteen of twenty-two scanned policies were walled this
// way -- mostly Tennessee districts on a SharePoint that earlier defeated every other reader too.
//   node tools/tasb/fetch-walled-pdf.mjs data/handbooks/ocr/scans.json data/handbooks/ocr
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const [,, IN, DIR] = process.argv;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const scans = JSON.parse(readFileSync(IN, "utf8"));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA });
let got = 0, failed = 0;
for (const sc of scans) {
  const h = createHash("sha1").update(sc.url).digest("hex").slice(0, 10);
  const out = `${DIR}/${h}.pdf`;
  if (existsSync(out) && readFileSync(out).subarray(0, 5).toString() === "%PDF-") { got++; continue; }
  try {
    const origin = new URL(sc.url).origin;
    const page = await ctx.newPage();
    // Earn the cookie on the front page; the challenge reloads itself, so give it a moment.
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    await page.close();
    const res = await ctx.request.get(sc.url, { timeout: 90_000, headers: { Accept: "application/pdf,*/*" } });
    const body = await res.body();
    if (res.ok() && body.subarray(0, 5).toString() === "%PDF-") { writeFileSync(out, body); got++; console.log(`  ✓ ${sc.state} ${sc.district.slice(0, 32)}  ${(body.length / 1024).toFixed(0)} KB`); }
    else { failed++; console.log(`  x ${sc.state} ${sc.district.slice(0, 32)}  ${res.status()} ${body.length} bytes, not a PDF`); }
  } catch (e) { failed++; console.log(`  x ${sc.state} ${sc.district.slice(0, 32)}  ${String(e.message).slice(0, 60)}`); }
}
await browser.close();
console.log(`\n${got} PDFs on disk, ${failed} still not fetchable`);
