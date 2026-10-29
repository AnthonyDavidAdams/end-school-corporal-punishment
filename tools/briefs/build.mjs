// Render the necessity memo and model brief (strategy/briefs/*.md) to letter-size PDFs in out/briefs/,
// in the EarthPilot document style used by tools/certificates/board-brief.mjs. Markdown is converted
// with pandoc; the page is laid out and printed with Playwright.
//
//   node tools/briefs/build.mjs                      # all three documents
//   node tools/briefs/build.mjs necessity-memo-MO    # one document
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS = {
  "necessity-memo": { kind: "Memo", sub: "State-neutral model", size: "11pt", lh: 1.45, margin: "0.9in" },
  "necessity-memo-MO": { kind: "Memo", sub: "Missouri", size: "11pt", lh: 1.45, margin: "0.9in" },
  "necessity-brief": { kind: "Model brief", sub: "For discussion, not legal advice, not a filing", size: "12pt", lh: 1.6, margin: "1in" },
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(DOCS);
const logo = "data:image/png;base64," + readFileSync(join(root, "site/assets/earthpilot.png")).toString("base64");
const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
mkdirSync(join(root, "out/briefs"), { recursive: true });

const css = `
@page{size:8.5in 11in;margin:0}
html,body{margin:0;background:#fff;color:#0D132D;font-family:'Source Sans 3',system-ui,sans-serif;font-size:11pt;line-height:1.45}
body{padding:0}
.top{display:flex;align-items:center;gap:10px;font-size:9pt;letter-spacing:.2em;text-transform:uppercase;color:#5A6577;border-bottom:1px solid #B7791F;padding-bottom:8px;margin-bottom:18px}
.top img{width:28px;height:28px;border-radius:50%}.top span.r{margin-left:auto;letter-spacing:.08em;text-transform:none}
h1{font-family:Merriweather,Georgia,serif;font-weight:900;font-size:19pt;line-height:1.25;margin:0 0 12px}
h2{font-family:Merriweather,Georgia,serif;font-size:13pt;margin:18px 0 6px;color:#0D132D;break-after:avoid}
h3{font-family:Merriweather,Georgia,serif;font-size:11.5pt;margin:14px 0 4px;color:#0D132D;break-after:avoid}
p{margin:0 0 8px}
blockquote{margin:6px 0 10px;padding:8px 14px;border-left:3px solid #B7791F;background:#FFFDF7;font-family:Merriweather,Georgia,serif;font-size:10.5pt;line-height:1.5}
blockquote p{margin:0 0 6px}
ul,ol{margin:4px 0 8px 20px;padding:0}li{margin:0 0 5px}
table{border-collapse:collapse;width:100%;margin:8px 0 12px;font-size:9.5pt;line-height:1.35}
th,td{border:1px solid #D9DEE8;padding:5px 7px;vertical-align:top;text-align:left}
th{background:#F7F8FB;font-size:8.5pt;letter-spacing:.1em;text-transform:uppercase;color:#5A6577}
tr{break-inside:avoid}
code{font-family:ui-monospace,Menlo,monospace;font-size:9.5pt;background:#F7F8FB;padding:0 3px;border-radius:3px}
em{font-style:italic}strong{font-weight:700}
hr{border:0;border-top:1px solid #E8ECF1;margin:14px 0}
#table-of-authorities{break-before:page}
.lead p:first-child em{display:block;border:1px solid #D9DEE8;background:#F7F8FB;border-radius:6px;padding:8px 12px;font-style:normal;font-size:10pt;color:#5A6577}
`;

for (const name of names) {
  const meta = DOCS[name]; if (!meta) { console.error(`unknown document ${name}`); process.exit(1); }
  const md = join(root, "strategy/briefs", `${name}.md`);
  const body = execFileSync("pandoc", ["-f", "markdown", "-t", "html5", "--wrap=none", md], { encoding: "utf8" });
  const title = (readFileSync(md, "utf8").match(/^#\s+(.+)$/m) || [, name])[1];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>${css}
body{font-size:${meta.size};line-height:${meta.lh}}
</style></head><body>
<div class="top"><img src="${logo}" alt=""><span>EarthPilot · Safe Schools Project</span><span class="r">${meta.kind} · ${meta.sub}</span></div>
<div class="lead">${body}</div>
</body></html>`;
  const out = join(root, "out/briefs", name);
  writeFileSync(out + ".html", html);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
  await p.setContent(html, { waitUntil: "networkidle" }); await p.waitForTimeout(600);
  await p.pdf({
    path: out + ".pdf", width: "8.5in", height: "11in", printBackground: true,
    margin: { top: "0.75in", bottom: "0.95in", left: meta.margin, right: meta.margin },
    displayHeaderFooter: true,
    headerTemplate: `<div></div>`,
    footerTemplate: `<div style="width:100%;font-family:'Source Sans 3',system-ui,sans-serif;font-size:8pt;color:#8B95A5;padding:0 ${meta.margin};display:flex;justify-content:space-between"><span>EarthPilot · Safe Schools Project · ${meta.kind.toLowerCase()} for discussion, not legal advice · ${today}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  });
  await b.close();
  console.log(`wrote ${out}.pdf`);
}
