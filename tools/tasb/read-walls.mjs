// Read the documents behind a JavaScript challenge, whatever they turn out to be.
//
// The PDF-only fetcher got 0 of 24, because a "walled URL" is as often an HTML handbook page as a
// file, and one that IS a file is served through Chrome's viewer. So: navigate with a real browser,
// let the challenge resolve, and take whichever came back -- the navigation response's bytes when
// it is a PDF, the rendered page's text when it is HTML. Broken Bow taught the other lesson: what is
// behind a wall can be a 404, and that is recorded as "dead", not "silent".
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const [,, IN, OUT] = process.argv;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ANCH = /corporal punishment|corporal|paddl|spank|swat|licks/i;
const NOT = ["physical restraint", "restraint and seclusion", "seclusion", "mechanical restraint", "chemical restraint", "self-defense", "imminent bodily harm"];
const clip = (t) => (t || "").split(/(?<=[.:;])\s+/).map((s) => s.replace(/\s+/g, " ").trim())
  .filter((s) => s.length > 30 && s.length < 600 && ANCH.test(s) && !NOT.some((n) => s.toLowerCase().includes(n)));
const CH = /Client Challenge|Just a moment|Incapsula|Pardon Our Interruption/i;

const targets = JSON.parse(readFileSync(IN, "utf8"));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA });
const rows = [];
for (const t of targets) {
  const page = await ctx.newPage();
  let outcome = "error", text = "";
  try {
    const res = await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(5000);   // the challenge reloads itself
    const ctype = (res?.headers()["content-type"] || "").toLowerCase();
    const status = res?.status() ?? 0;
    if (ctype.includes("pdf") || page.url().toLowerCase().split("?")[0].endsWith(".pdf")) {
      // Re-request through the same context so the challenge cookie is sent, and take the bytes.
      const r = await ctx.request.get(page.url(), { timeout: 90_000 });
      const body = await r.body();
      if (body.subarray(0, 5).toString() === "%PDF-") {
        writeFileSync("/tmp/wall.pdf", body);
        try { text = execFileSync("pdftotext", ["-layout", "/tmp/wall.pdf", "-"], { maxBuffer: 64e6 }).toString(); } catch { text = ""; }
        if (text.trim().length < 500) { try { execFileSync("ocrmypdf", ["--force-ocr", "--sidecar", "/tmp/wall.txt", "--quiet", "/tmp/wall.pdf", "/dev/null"], { timeout: 900_000 }); text = readFileSync("/tmp/wall.txt", "utf8"); } catch { /* keep what we have */ } }
        outcome = "pdf";
      } else outcome = "pdf-not-served";
    } else {
      const html = await page.content();
      const plain = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      if (CH.test(plain.slice(0, 4000))) outcome = "still walled";
      else if (status === 404 || /page not found|404/i.test(plain.slice(0, 3000))) outcome = "dead (404 behind the wall)";
      else if (plain.length < 2000) outcome = "stub";
      else { text = plain; outcome = "html"; }
    }
  } catch (e) { outcome = `error: ${String(e.message).slice(0, 50)}`; }
  await page.close();
  const cands = clip(text);
  const verdict = cands.length ? "rule" : (outcome === "html" || outcome === "pdf") ? "silent" : "unreadable";
  rows.push({ site: null, district: t.district, _state: t.state, verdict, outcome, chars: text.length,
    policies: cands.length ? [{ code: null, title: `document behind a challenge, read by browser (${outcome})`, url: page.url?.() ?? t.url, candidates: cands.slice(0, 40), last_revised: null }] : [] });
  console.log(`  ${cands.length ? "✓" : "·"} ${t.state} ${t.district.slice(0, 30).padEnd(32)} ${outcome.padEnd(26)} ${text.length.toLocaleString().padStart(8)} chars, ${cands.length} sentences`);
}
await browser.close();
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const c = {}; for (const r of rows) c[r.verdict] = (c[r.verdict] || 0) + 1;
console.log(`\n  ${JSON.stringify(c)}`);
