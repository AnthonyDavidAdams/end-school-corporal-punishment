// Renders the built certificate pages to PDF so they can be attached to an email.
//
// Usage: node tools/certificate-pdf.mjs [slug ...]      (no arguments renders all of them)
// Output: out/certificates/<slug>.pdf
//
// Chrome headless prints the same page the district sees on the web, so there is one source of truth
// for the wording. The page carries `@page { size: letter landscape; margin: 0 }`, which is what makes
// the sheet fill the paper; do not pass --no-pdf-header-footer flags expecting them to do that job.
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));
if (!CHROME) { console.error("No Chrome or Chromium found; install one or set the path in this file."); process.exit(1); }

const src = join(root, "site/stopped");
const out = join(root, "out/certificates");
mkdirSync(out, { recursive: true });

const wanted = process.argv.slice(2);
const slugs = readdirSync(src).filter((d) => d !== "index.html" && existsSync(join(src, d, "index.html")))
  .filter((d) => !wanted.length || wanted.includes(d));

let ok = 0, failed = 0;
for (const s of slugs) {
  const file = `file://${join(src, s, "index.html")}`;
  const pdf = join(out, `${s}.pdf`);
  try {
    // --headless=new prints with CSS paged media honoured; the older headless ignored @page size.
    await run(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, file], { timeout: 60000 });
    ok++;
    process.stdout.write(`${ok + failed}/${slugs.length} ${s}\r`);
  } catch (e) { failed++; console.error(`\nFAILED ${s}: ${String(e.message).slice(0, 120)}`); }
}
console.log(`\n${ok} certificates written to out/certificates${failed ? `, ${failed} failed` : ""}`);
