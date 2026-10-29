#!/usr/bin/env node
// Build the parent guide "After a paddling" the way the kit's other PDFs are built: markdown + data -> one
// print-styled HTML page -> Chrome headless -> PDF. Writes out/kit/after-a-paddling.{html,pdf} and copies the
// PDF to site/kit/. Also renders the share image (1200x630) to site/assets/og-after-a-paddling.png.
// The web page itself (site/kit/after-a-paddling/) is written by tools/build-site.mjs from the same body.
import { writeFileSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { guideBody } from "../lib/after-a-paddling.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "out", "kit");
mkdirSync(out, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const g = guideBody(root);
const today = new Date().toISOString().slice(0, 10);

const CSS = `
@page{size:Letter;margin:0.8in 0.8in 0.9in}
:root{--ink:#1B2A41;--muted:#5E6A8A;--rule:#D9DCE3;--accent:#9B2C2C;--band:#FBF3EC}
html{font-size:14.5px}body{margin:0;color:var(--ink);font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;line-height:1.5;background:#fff}
.page{max-width:46rem;margin:0 auto;padding:2rem 1.25rem 4rem}
.masthead{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid var(--ink);padding-bottom:.5rem;margin-bottom:2rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.masthead b{font-size:1.05rem;letter-spacing:.02em}.masthead span{color:var(--muted);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase}
.cover{margin:2rem 0 3rem}.cover .k{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700}
.cover h1{font-size:2.5rem;line-height:1.1;margin:.4rem 0 .8rem;font-weight:600;letter-spacing:-.01em}.cover p{font-size:1.1rem;max-width:38rem}.cover .meta{color:var(--muted);font-size:.9rem;margin-top:1.5rem}
h1{font-size:1.9rem;line-height:1.15;margin:0 0 .6rem;font-weight:600}
h2{font-size:1.3rem;margin:2.2rem 0 .5rem;font-weight:600;border-bottom:1px solid var(--rule);padding-bottom:.25rem}
h3{font-size:1.05rem;margin:1.5rem 0 .4rem;font-weight:600}
p{margin:.6rem 0}ul,ol{padding-left:1.4rem}li{margin:.3rem 0}
blockquote{margin:1rem 0;padding:.3rem 0 .3rem 1.1rem;border-left:3px solid var(--accent)}
.notice{background:var(--band);border:1px solid #E8D5C4;padding:.7rem 1rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.9rem;margin:1rem 0}
table{border-collapse:collapse;width:100%;font-size:.8rem;margin:.8rem 0}th,td{text-align:left;vertical-align:top;padding:.4rem .5rem;border-bottom:1px solid var(--rule)}th{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
td .note{color:var(--muted);font-size:.74rem}q{quotes:"\\201C" "\\201D"}
a{color:var(--accent);text-decoration:none}hr{border:0;border-top:1px solid var(--rule);margin:2rem 0}
.foot{margin-top:3rem;padding-top:.8rem;border-top:1px solid var(--rule);color:var(--muted);font-size:.8rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
@media print{.page{max-width:none;padding:0}h2,h3{page-break-after:avoid}blockquote,tr{page-break-inside:avoid}table.states,table.deadlines,table.lawyers{font-size:.72rem}}
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${g.title} | End School Corporal Punishment</title>
<meta name="description" content="${g.description}">
<meta property="og:title" content="${g.title}"><meta property="og:description" content="${g.description}"><meta property="og:image" content="https://earthpilot.org/kids/assets/og-after-a-paddling.png"><meta property="og:url" content="https://earthpilot.org/kids/kit/after-a-paddling/"><meta property="og:type" content="article"><meta property="og:site_name" content="End School Corporal Punishment">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${g.title}"><meta name="twitter:description" content="${g.description}"><meta name="twitter:image" content="https://earthpilot.org/kids/assets/og-after-a-paddling.png">
<style>${CSS}</style></head><body><div class="page">
<div class="masthead"><b>EarthPilot · End School Corporal Punishment</b><span>earthpilot.org/kids</span></div>
<div class="cover"><div class="k">For parents and students</div><h1>${g.title}</h1><p>${g.description}</p><p class="meta">Version ${today} · Statutes and deadlines read at each state's own statute site on ${g.verified} · The web version, with live links, is at earthpilot.org/kids/kit/after-a-paddling/ · Free to use and share (CC BY 4.0)</p></div>
${g.body.replace(/^<h1[^>]*>.*?<\/h1>\n?/, "")}
<div class="foot">End School Corporal Punishment · EarthPilot · earthpilot.org/kids · This guide is general information, not legal advice. Talk to a lawyer licensed in your state.</div>
</div></body></html>`;

const htmlPath = join(out, "after-a-paddling.html");
const pdfPath = join(out, "after-a-paddling.pdf");
writeFileSync(htmlPath, html);
execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, "--virtual-time-budget=10000", `file://${htmlPath}`], { stdio: "ignore" });
mkdirSync(join(root, "site", "kit"), { recursive: true });
copyFileSync(pdfPath, join(root, "site", "kit", "after-a-paddling.pdf"));

// Share image: a typographic card, same palette, rendered by Chrome at 1200x630.
const ogHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;background:#1B2A41;color:#fff;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.c{position:absolute;inset:0;padding:70px 80px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between}
.k{font-size:24px;letter-spacing:6px;text-transform:uppercase;color:#F26A3D;font-weight:700}
h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-size:84px;line-height:1.05;margin:20px 0 0;font-weight:600;letter-spacing:-1px}
p{font-size:30px;line-height:1.3;color:#C9D1DD;margin:24px 0 0;max-width:980px}
.f{display:flex;justify-content:space-between;align-items:baseline;border-top:2px solid #3A4A63;padding-top:22px;font-size:24px;color:#C9D1DD}.f b{color:#fff}
</style></head><body><div class="c"><div><div class="k">For parents and students</div><h1>After a paddling:<br>what a family can do</h1><p>The first forty-eight hours, your state's statute, the five routes that work, the deadlines, and when a lawsuit is realistic.</p></div><div class="f"><span><b>End School Corporal Punishment</b> · EarthPilot</span><span>earthpilot.org/kids/kit/after-a-paddling/</span></div></div></body></html>`;
const ogSrc = join(out, "og-after-a-paddling.html");
const ogPng = join(root, "site", "assets", "og-after-a-paddling.png");
writeFileSync(ogSrc, ogHtml);
execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1200,630", `--screenshot=${ogPng}`, `file://${ogSrc}`], { stdio: "ignore" });

console.log(`html ${statSync(htmlPath).size} bytes; pdf ${statSync(pdfPath).size} bytes; og ${statSync(ogPng).size} bytes`);
