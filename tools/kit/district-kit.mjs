#!/usr/bin/env node
// A district's own copy of the Safe Discipline Program kit, as one PDF for the board packet:
//   cover (prepared for the district) -> the two-page board brief (tools/certificates/board-brief.mjs)
//   -> the seven kit documents with the district's name, policy numbering, reported figure and
//   superintendent filled in where the generic kit has [BRACKETS]. Dates, vote counts and the phone stay
//   as placeholders for the clerk. Same type and page setup as the generic kit (tools/kit/build.sh).
//
//   node tools/kit/district-kit.mjs --nces 4013290 [--superintendent "Missy Berry"] [--email x@y] [--code FOB] [--out path.pdf]
// Prints "wrote <path>" on success. The desk calls this when a district asks for the kit to be sent.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const nces = arg("nces"); if (!nces) { console.error("--nces required"); process.exit(1); }
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const STATE = { AL: "Alabama", AR: "Arkansas", AZ: "Arizona", FL: "Florida", GA: "Georgia", IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MO: "Missouri", MS: "Mississippi", NC: "North Carolina", OK: "Oklahoma", SC: "South Carolina", TN: "Tennessee", TX: "Texas", WY: "Wyoming", CO: "Colorado", ID: "Idaho", NM: "New Mexico" };
// Where the policy lands in each state association's manual (kit/01-model-policy.md), used when the record has no code.
const CODE = { AR: "4.39", MO: "JGA", OK: "FO", MS: "JDB", AL: "JDB", GA: "JDA", TX: "FO(LOCAL)", TN: "6.314", KS: "JDA", WY: "JKAA", LA: "JDB", SC: "JDA", FL: "5630", IN: "5630" };

// ---- the district
let d = null, state = null;
for (const f of readdirSync(join(root, "data/districts")).filter((f) => /^[A-Z]{2}\.yaml$/.test(f))) {
  const y = YAML.parse(readFileSync(join(root, "data/districts", f), "utf8"));
  const r = (y.districts || []).find((x) => String(x.nces_id) === String(nces));
  if (r) { d = r; state = y.state || f.slice(0, 2); break; }
}
if (!d) { console.error(`no district record for NCES ${nces}`); process.exit(1); }
const name = String(d.name).replace(/\s*\(\d+\)\s*$/, "");
const nice = name === name.toUpperCase() ? name.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase()) : name;
const reqs = JSON.parse(readFileSync(join(root, "data/outreach/requests.json"), "utf8"));
const req = reqs.find((r) => String(r.nces_id) === String(nces) && r.kind !== "align") || {};
const sup = arg("superintendent", req.superintendent || "");
const supNice = /,/.test(sup) ? sup.split(",").map((s) => s.trim()).reverse().join(" ").replace(/\b([A-Z])\.?\s*$/, "").trim() : sup;   // "PIERCE, MICHAEL S." -> "Michael Pierce"
const supCased = supNice === supNice.toUpperCase() ? supNice.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase()) : supNice;
const email = arg("email", req.to || "");
const code = arg("code", d.policy_code || CODE[state] || "[NUMBER]");
const crdc = readFileSync(join(root, "data/crdc/2023-24/districts.csv"), "utf8").split("\n").find((l) => l.split(",")[1] === String(nces));
const reported = crdc ? Number(crdc.split(",").pop()) : 0;   // the extract lists only districts with a count
const slug = `${state.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
const outDir = join(root, "out/kit/districts"); mkdirSync(outDir, { recursive: true });
const out = resolve(arg("out", join(outDir, `${slug}.pdf`)));
const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

// ---- the brief (two pages, its own builder)
const briefBase = join(root, "out/briefs", slug);
if (!existsSync(briefBase + ".pdf")) {
  const a = ["certificates/board-brief.mjs", "--nces", String(nces), "--out", briefBase]; if (arg("code")) a.push("--code", arg("code"));
  execFileSync("node", a, { cwd: join(root, "tools"), stdio: ["ignore", "ignore", "inherit"] });
}

// ---- the seven documents, filled in
// The policy and resolution are hard-wrapped in fenced blocks in the source; on paper a paragraph should flow.
const unwrap = (md) => md.replace(/```\n([\s\S]*?)```/g, (m, block) => {
  const lines = block.split("\n"), out = [];
  const heading = (l) => /^(\d+\.\s+)?[A-Z][A-Z ,'&:()-]+$/.test(l.trim()) || /^(Adopted|Rescinds|ADOPTED|RESOLUTION|OF THE|POLICY \S+:)/.test(l.trim());
  for (const l of lines) {
    const prev = out[out.length - 1];
    const cont = /^\s+\S/.test(l) && prev !== undefined && /^\s*\(\w\)\s/.test(prev.split(" ")[0] + " ") ? true : /^\s+\S/.test(l) && prev !== undefined && prev.trim() && !heading(prev);   // an indented line under a lettered item
    if (prev !== undefined && prev.trim() && l.trim() && !heading(l) && !heading(prev) && !/^\s*\d+\.\s|^\s*\(\w\)\s/.test(l) && (cont || !/^\s/.test(l))) out[out.length - 1] = prev + " " + l.trim();
    else out.push(l);
  }
  return "```\n" + out.join("\n") + "```";
});
const fill = (md) => unwrap(md)
  .replace(/\[DISTRICT NAME\] BOARD OF EDUCATION/g, `${nice.toUpperCase()} BOARD OF EDUCATION`)   // the policy header is set in capitals
  .replace(/\[DISTRICT NAME\]/g, nice)
  .replace(/POLICY \[NUMBER\]/g, `POLICY ${code}`).replace(/Policy \[NUMBER\]/g, `Policy ${code}`)
  .replace(/\[XX\]/g, state.toLowerCase())
  .replace(/that \[N\] of its\s+students received corporal punishment/g, reported ? `that ${reported} of its students received corporal punishment` : "that none of its students received corporal punishment")
  .replace(/reported \[N\] students to the federal government/g, reported ? `reported ${reported} students to the federal government` : "reported to the federal government that no students received it")
  .replace(/that \[N\] of our students received it/g, reported ? `that ${reported} of our students received it` : "that none of our students received it")
  .replace(/\[NAME\], Superintendent/g, `${supCased || "[NAME]"}, Superintendent`)
  .replace(/\[EMAIL\]/g, email || "[EMAIL]");
const ORDER = ["README", "01-model-policy", "02-board-motion", "03-announcement-staff", "04-announcement-parents", "05-announcement-students", "06-history", "07-training-transition-alternatives"];
const SED = (s) => s   // the same link flattening as tools/kit/build.sh
  .replace(/\[([^\]]+)\]\([0-9]{2}-[a-z-]+\.md\)/g, "$1").replace(/\[([^\]]+)\]\(\.\.\/[^)]+\)/g, "$1")
  .replace(/`\.\.\/training\/modules\/`/g, "the training modules").replace(/`\.\.\/training\/evidence\.md`/g, "the evidence base")
  .replace(/`\.\.\/facts\/claims\/`/g, "the facts registry").replace(/`\.\.\/facts\/README\.md`/g, "the facts registry index")
  .replace(/`\.\.\/training\/modules\/([0-9]+)-[a-z-]+\.md`/g, "Module $1").replace(/`\.\.\/templates\/[a-z-]+\.md`/g, "the templates");
let body = "";
for (const f of ORDER) {
  const md = SED(fill(readFileSync(join(root, "kit", f + ".md"), "utf8")));
  body += execFileSync("pandoc", ["--from", "gfm", "--to", "html5", "--wrap=none"], { input: md, encoding: "utf8" }) + '<div class="pagebreak"></div>\n';
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const CSS = readFileSync(join(root, "tools/kit/build.sh"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Safe Discipline Program kit for ${esc(nice)}</title><style>${CSS}
.prep{margin:1.5rem 0 0;padding:1rem 1.2rem;border:1px solid var(--rule);background:#F5F6F8;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.92rem}
.prep b{display:block;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:.3rem}
</style></head><body><div class="page">
<div class="masthead"><b>EarthPilot · End School Corporal Punishment</b><span>earthpilot.org/kids</span></div>
<div class="cover"><div class="k">Prepared for ${esc(nice)}, ${esc(STATE[state] || state)}</div><h1>The Safe Discipline Program kit</h1>
<p>Everything the board needs on one agenda: the policy in ${esc(nice)}'s name and numbering, the motion and the resolution, the words for staff, families and students, the history, the training, and the ninety days between the vote and the change.</p>
<div class="prep"><b>In this packet</b>
<div>Pages 2 and 3: the two-page board brief for ${esc(nice)}. What the written policy says now, what other ${esc(STATE[state] || state)} boards adopted, and the paragraph the board can adopt as written.</div>
<div style="margin-top:.4rem">Then the kit: Policy ${esc(code)} written for ${esc(nice)}, the motion a member reads, the resolution with every figure sourced, and the letters and scripts for the week after the vote. Brackets that remain are the clerk's: dates, the vote, the phone number.</div></div>
<p class="meta">Prepared ${esc(today)}${supCased ? ` at the request of Superintendent ${esc(supCased)}` : ""} · Offered as an in-kind grant from EarthPilot.org, no cost to the district · Every figure carries the id of a verified claim at earthpilot.org/kids/resources/ · Free to use and adapt (CC BY 4.0) · Questions: Anthony David Adams, anthony@175g.com</p></div>
<div class="pagebreak"></div>
${body}
<div class="foot">The Safe Discipline Program · EarthPilot · earthpilot.org/kids · Prepared for ${esc(nice)}, ${esc(STATE[state] || state)} · The coach that answers questions about this kit is at galley.so/safe-discipline</div>
</div></body></html>`;
const htmlPath = join(outDir, slug + ".html"), kitPdf = join(outDir, slug + ".kit.pdf");
writeFileSync(htmlPath, html);
execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${kitPdf}`, "--virtual-time-budget=10000", `file://${htmlPath}`], { stdio: "ignore" });
// cover, then the brief, then the kit
execFileSync("qpdf", ["--empty", "--pages", kitPdf, "1", briefBase + ".pdf", "1-z", kitPdf, "2-z", "--", out]);
console.log(`wrote ${out}`);
