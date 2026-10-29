#!/usr/bin/env node
// Build "A Christian's Guide to Corporal Punishment" the way the kit's other PDFs are built: markdown ->
// one print-styled HTML page -> Chrome headless -> PDF. Writes out/kit/a-christians-guide.{html,pdf} and
// copies the PDF to site/kit/, writes the one-page read-aloud version to site/kit/a-christians-guide-one-page.pdf,
// and renders the share image (1200x630) to site/assets/og-a-christians-guide.png.
// The web page itself (site/kit/a-christians-guide/) is written by tools/build-site.mjs from the same body.
import { writeFileSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { guideBody } from "../lib/a-christians-guide.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "out", "kit");
mkdirSync(out, { recursive: true });
mkdirSync(join(root, "site", "kit"), { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const g = guideBody(root);
const today = new Date().toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const CSS = `
@page{size:Letter;margin:0.85in 0.9in 0.95in}
:root{--ink:#1B2A41;--muted:#5E6A8A;--rule:#D9DCE3;--accent:#9B2C2C;--band:#FBF3EC}
html{font-size:14.5px}body{margin:0;color:var(--ink);font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;line-height:1.55;background:#fff}
.page{max-width:44rem;margin:0 auto;padding:2rem 1.25rem 4rem}
.masthead{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid var(--ink);padding-bottom:.5rem;margin-bottom:2rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.masthead b{font-size:1.05rem;letter-spacing:.02em}.masthead span{color:var(--muted);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase}
.cover{margin:2rem 0 3rem}.cover .k{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700}
.cover h1{font-size:2.5rem;line-height:1.1;margin:.4rem 0 .8rem;font-weight:600;letter-spacing:-.01em}.cover p{font-size:1.1rem;max-width:36rem}.cover .meta{color:var(--muted);font-size:.9rem;margin-top:1.5rem}
h1{font-size:1.9rem;line-height:1.15;margin:0 0 .6rem;font-weight:600}
h2{font-size:1.3rem;margin:2.2rem 0 .5rem;font-weight:600;border-bottom:1px solid var(--rule);padding-bottom:.25rem}
h3{font-size:1.05rem;margin:1.5rem 0 .4rem;font-weight:600}
p{margin:.6rem 0}ul,ol{padding-left:1.4rem}li{margin:.3rem 0}
blockquote{margin:1rem 0 1rem .2rem;padding:.3rem 0 .3rem 1.1rem;border-left:3px solid var(--accent);font-style:italic}
blockquote em{font-style:normal}
.notice{background:var(--band);border:1px solid #E8D5C4;padding:.7rem 1rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.9rem;margin:1rem 0}
.cite{color:var(--muted);font-size:.78rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}.cite a{color:var(--muted)}
a{color:var(--accent);text-decoration:none}hr{border:0;border-top:1px solid var(--rule);margin:2rem 0}
.foot{margin-top:3rem;padding-top:.8rem;border-top:1px solid var(--rule);color:var(--muted);font-size:.8rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.readaloud h1{font-size:2rem;margin-bottom:1.2rem}.readaloud p{font-size:1.08rem;line-height:1.6}.readaloud blockquote{margin-left:0}
@media print{.page{max-width:none;padding:0}h2,h3{page-break-after:avoid}blockquote{page-break-inside:avoid}.pagebreak{page-break-before:always}}
`;

const head = (title, description, path) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | End School Corporal Punishment</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="https://earthpilot.org/kids/assets/og-a-christians-guide.png"><meta property="og:url" content="https://earthpilot.org/kids${path}"><meta property="og:type" content="article"><meta property="og:site_name" content="End School Corporal Punishment">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="https://earthpilot.org/kids/assets/og-a-christians-guide.png">
<style>${CSS}</style></head><body><div class="page">
<div class="masthead"><b>EarthPilot · End School Corporal Punishment</b><span>earthpilot.org/kids</span></div>`;

const foot = `<div class="foot">End School Corporal Punishment · EarthPilot · earthpilot.org/kids · Scripture quotations are from the King James Version (public domain). Free to use and share (CC BY 4.0).</div></div></body></html>`;

// The booklet.
const html = `${head(g.title, g.description, "/kit/a-christians-guide/")}
<div class="cover"><div class="k">${esc(g.kicker)}</div><h1>${esc(g.title)}</h1><p>${esc(g.description)}</p><p class="meta">Version ${today} · Every verse checked against the King James text; every research finding and church position carries the id of a verified claim in the project's facts registry · The web version, with live links, is at earthpilot.org/kids/kit/a-christians-guide/ · Free to use and share (CC BY 4.0)</p></div>
${g.body.replace(/^<h1[^>]*>.*?<\/h1>\n?/, "")}
${foot}`;

const htmlPath = join(out, "a-christians-guide.html");
const pdfPath = join(out, "a-christians-guide.pdf");
writeFileSync(htmlPath, html);
execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, "--virtual-time-budget=10000", `file://${htmlPath}`], { stdio: "ignore" });
copyFileSync(pdfPath, join(root, "site", "kit", "a-christians-guide.pdf"));

// The read-aloud page on its own.
const oneTitle = "A Christian's Guide to Corporal Punishment: a page to read aloud";
const oneHtml = `${head(oneTitle, "The closing page of A Christian's Guide to Corporal Punishment, written to be read aloud in under three minutes.", "/kit/a-christians-guide/")}
<style>@page{margin:0.65in 0.85in 0.6in}html{font-size:13.5px}.masthead{margin-bottom:1rem}.readaloud h1{font-size:1.8rem;margin-bottom:.8rem}.readaloud p{font-size:1.02rem;line-height:1.5;margin:.5rem 0}.foot{margin-top:1.2rem}</style>
<div class="readaloud"><div class="cover" style="margin:1rem 0 1.5rem"><div class="k">${esc(g.kicker)} · read aloud in under three minutes</div></div>
${g.onePage.replace(/^<h2[^>]*>(.*?)<\/h2>/, "<h1>$1</h1>")}
<p class="cite">The whole guide, with every verse and every source, is at earthpilot.org/kids/kit/a-christians-guide/</p></div>
${foot}`;
const oneHtmlPath = join(out, "a-christians-guide-one-page.html");
const onePdfPath = join(out, "a-christians-guide-one-page.pdf");
writeFileSync(oneHtmlPath, oneHtml);
execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${onePdfPath}`, "--virtual-time-budget=10000", `file://${oneHtmlPath}`], { stdio: "ignore" });
copyFileSync(onePdfPath, join(root, "site", "kit", "a-christians-guide-one-page.pdf"));

// Share image: a typographic card in the kit's palette, rendered by Chrome at 1200x630.
const ogHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;background:#1B2A41;color:#fff;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.c{position:absolute;inset:0;padding:70px 80px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between}
.k{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#F26A3D;font-weight:700}
h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-size:80px;line-height:1.05;margin:20px 0 0;font-weight:600;letter-spacing:-1px}
p{font-size:30px;line-height:1.3;color:#C9D1DD;margin:24px 0 0;max-width:1000px;font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-style:italic}
.f{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid #3A4A63;padding-top:22px;font-size:24px;color:#C9D1DD}.f b{color:#fff}
</style></head><body><div class="c"><div><div class="k">For pastors, church members, and school boards</div><h1>A Christian's Guide to<br>Corporal Punishment</h1><p>"Nevertheless afterward it yieldeth the peaceable fruit of righteousness." Hebrews 12:11. The rod verses read honestly, the fruit test, and what the churches have said. By a former minister.</p></div><div class="f"><span><b>End School Corporal Punishment</b> · EarthPilot</span><span>earthpilot.org/kids/kit/a-christians-guide/</span></div></div></body></html>`;
const ogSrc = join(out, "og-a-christians-guide.html");
const ogPng = join(root, "site", "assets", "og-a-christians-guide.png");
writeFileSync(ogSrc, ogHtml);
execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1200,630", `--screenshot=${ogPng}`, `file://${ogSrc}`], { stdio: "ignore" });

console.log(`html ${statSync(htmlPath).size} bytes; pdf ${statSync(pdfPath).size} bytes; one-page pdf ${statSync(onePdfPath).size} bytes; og ${statSync(ogPng).size} bytes`);
