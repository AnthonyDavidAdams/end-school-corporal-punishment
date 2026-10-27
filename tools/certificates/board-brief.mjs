// A two-page brief for a school board whose written policy still permits corporal punishment while the
// district reports no use of it: what the policy says now, what the district reported, what the
// state's other boards adopted instead (the exact sentence most of them use), what the research and
// the professional bodies say, and a one-paragraph policy the board can adopt as written. EarthPilot
// style, letter portrait, PDF + PNG via Playwright.
//
//   node tools/certificates/board-brief.mjs --nces 4823640 [--out out/briefs/tx-houston]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const nces = arg("nces"); if (!nces) { console.error("--nces required"); process.exit(1); }
const lag = JSON.parse(readFileSync(join(root, "data/outreach/policy-lag.json"), "utf8"));
const d = lag.find((x) => x.nces_id === nces); if (!d) { console.error("not in the policy-lag list"); process.exit(1); }
const model = JSON.parse(readFileSync(join(root, "data/states/model-language.json"), "utf8"));
const states = JSON.parse(readFileSync(join(root, "site/data/states.json"), "utf8"));
const STATE = { AL: "Alabama", AR: "Arkansas", AZ: "Arizona", FL: "Florida", GA: "Georgia", IN: "Indiana", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MO: "Missouri", MS: "Mississippi", NC: "North Carolina", OK: "Oklahoma", SC: "South Carolina", TN: "Tennessee", TX: "Texas", WY: "Wyoming", CO: "Colorado", ID: "Idaho", NM: "New Mexico" }[d.state] || d.state;
const name = d.name.replace(/\s*\(\d+\)\s*$/, "");
const m = model[d.state] || {};
const DEFAULT = "The Board prohibits the use of corporal punishment in the District.";
const modelLine = m.used_by >= 5 ? m.modal_quote : DEFAULT;
const modelNote = m.used_by >= 5 ? `the sentence ${m.used_by} ${STATE} boards already use${m.modal_code ? ` (policy ${m.modal_code})` : ""}` : `the sentence most Texas boards use (TASB FO(LOCAL)); ${m.bans || 0} ${STATE} boards have adopted a prohibition in their own words`;
const sup = arg("superintendent", "");
const out = arg("out", join(root, "out/briefs", `${d.state.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`));
mkdirSync(dirname(out), { recursive: true });
const logo = "data:image/png;base64," + readFileSync(join(root, "site/assets/earthpilot.png")).toString("base64");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
// A clipped sentence sometimes carries its section heading in front ("Corporal Punishment Corporal punishment may..."): show the sentence.
const tidy = (q) => String(q || "").replace(/^(?:[A-Z]{2,5}\s+)?(?:\d+[\s\u2013\u2014:.\-]*)?CORPORAL PUNISHMENT[:.\s\-\u2013]*(?:\([^)]*\)\s*)?(?=[A-Z])/, "").replace(/^Corporal Punishment\s+(?=(?:Corporal|The|No|Any|Principals|Employees|Using|Physical|A |An ))/, "").trim();
const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Board brief: ${esc(name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{size:8.5in 11in;margin:0}html,body{margin:0;background:#fff;color:#0D132D;font-family:'Source Sans 3',system-ui,sans-serif;font-size:11pt;line-height:1.42}
.page{width:8.5in;height:11in;padding:.7in .85in .85in;box-sizing:border-box;position:relative;overflow:hidden;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}
.top{display:flex;align-items:center;gap:10px;font-size:9pt;letter-spacing:.2em;text-transform:uppercase;color:#5A6577;border-bottom:1px solid #B7791F;padding-bottom:8px;margin-bottom:16px}.top img{width:28px;height:28px;border-radius:50%}.top span.r{margin-left:auto;letter-spacing:.08em;text-transform:none}
h1{font-family:Merriweather,Georgia,serif;font-weight:900;font-size:21pt;line-height:1.2;margin:0 0 4px}.sub{color:#5A6577;font-size:12pt;margin:0 0 18px}
h2{font-family:Merriweather,Georgia,serif;font-size:12pt;margin:14px 0 5px;color:#0D132D}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:8px 0 4px}.card{border:1px solid #D9DEE8;border-radius:6px;padding:10px 13px;background:#F7F8FB}.card .k{font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:#B7791F;margin-bottom:4px}.card .v{font-family:Merriweather,Georgia,serif;font-size:13pt;line-height:1.35}.card .s{font-size:9.5pt;color:#5A6577;margin-top:4px}
blockquote{margin:5px 0 3px;padding:8px 12px;border-left:3px solid #B7791F;background:#FFFDF7;font-family:Merriweather,Georgia,serif;font-size:12pt;line-height:1.45}
.adopt{border:1.5px solid #0D132D;border-radius:6px;padding:14px 16px;margin:8px 0 4px;background:#fff}.adopt .k{font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:#B7791F;margin-bottom:6px}.adopt p{margin:0;font-family:Merriweather,Georgia,serif;font-size:12.5pt;line-height:1.5}
ul{margin:4px 0 0 18px;padding:0}li{margin:0 0 5px}.orgs{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:9.5pt;letter-spacing:.08em;text-transform:uppercase;margin:4px 0 0}.orgs i{font-style:normal;color:#B7791F;margin-left:3px}
.small{font-size:9.5pt;color:#5A6577}.foot{position:absolute;left:.85in;right:.85in;bottom:.5in;font-size:8.5pt;color:#8B95A5;border-top:1px solid #E8ECF1;padding-top:6px;display:flex;justify-content:space-between}
</style></head><body>
<div class="page">
<div class="top"><img src="${logo}" alt=""><span>EarthPilot · Safe Schools Project</span><span class="r">Board brief · ${esc(today)}</span></div>
<h1>An invitation: ${esc(name)} as a Safe School for 2026-27</h1>
<p class="sub">The district already runs its schools without corporal punishment. Its written policy still permits it. One paragraph aligns the two, and the recognition follows, alongside ${m.bans ? `${m.bans} other ${STATE} boards` : "most boards nationally"}.</p>
<div class="row">
<div class="card"><div class="k">What the district reported</div><div class="v">${d.reported_2023_24 === 0 ? "Zero students" : "No students"} received corporal punishment</div><div class="s">Federal Civil Rights Data Collection, 2023-24, as reported by the district.</div></div>
<div class="card"><div class="k">What the written policy says</div><div class="v">It ${d.status === "consent_required" ? "permits it with a parent's consent" : "permits it"}</div><div class="s">${d.policy_code ? `Policy ${esc(d.policy_code)}` : "The policy on file"}${d.source ? `, as published` : ""}.</div></div>
</div>
<blockquote>“${esc(tidy(d.quote))}”</blockquote>
<p class="small">The district's own wording, quoted from ${d.source ? `<span style="word-break:break-all">${esc(d.source)}</span>` : "the document on file"}.</p>

<h2>What other ${STATE} boards adopted</h2>
<p>${m.bans ? `${m.bans} ${STATE} districts have a written policy that prohibits corporal punishment. ` : ""}Most used ${esc(modelNote)}:</p>
<blockquote>“${esc(tidy(modelLine))}”</blockquote>

<h2>What the research says</h2>
<ul>
<li>A 2022 meta-analysis of school corporal punishment specifically, across 21 studies and more than 67,000 children, found it associated with more aggressive and disruptive behavior, more anxiety and depression, and lower school performance.</li>
<li>A 2019 study of more than 800 young adults from the states where it was legal found that those who received it in school had lower high school GPAs and more depressive symptoms.</li>
<li>The 2016 review of 75 studies and 160,927 children found physical punishment linked to 13 of 17 outcomes studied, every one in the direction of harm and none in the direction of benefit.</li>
</ul>
<div class="foot"><span>Sources for every figure: earthpilot.org/kids/resources/</span><span>Page 1 of 2</span></div>
</div>

<div class="page">
<div class="top"><img src="${logo}" alt=""><span>EarthPilot · Safe Schools Project</span><span class="r">${esc(name)}, ${esc(STATE)}</span></div>
<h2 style="margin-top:0">Who is on record against it</h2>
<div class="orgs"><span>American Academy of Pediatrics <i>2023</i></span><span>American Psychological Association <i>2016</i></span><span>American Academy of Child &amp; Adolescent Psychiatry <i>2012</i></span><span>National Association of School Psychologists <i>2021</i></span><span>National PTA</span><span>U.S. Secretary of Education <i>2023</i></span><span>ACLU, NAACP, NEA, Children's Defense Fund <i>2016 open letter</i></span></div>
<p class="small" style="margin-top:8px">The American Academy of Pediatrics in 2023 called for corporal punishment to be abolished in all school settings in every state. The U.S. Secretary of Education wrote to every governor and state education chief in March 2023 asking them to end it. Thirty-three states prohibit it by law.</p>

<h2>Why boards change the paper even when the practice has stopped</h2>
<ul>
<li><b>Liability.</b> A policy that authorizes striking students is the first exhibit in any claim arising from it. A superintendent in Kansas who took his board through the change called the old policy “a great way to harvest litigation.”</li>
<li><b>Clarity for staff and families.</b> Handbooks and policy manuals are read by new teachers and new parents. If the practice has stopped, the documents should say so.</li>
<li><b>Nothing is lost.</b> Every tool the district actually uses for discipline stays exactly as it is.</li>
</ul>

<h2>Language the board can adopt as written</h2>
<div class="adopt"><div class="k">Proposed policy ${d.policy_code ? `(replacing ${esc(d.policy_code)})` : ""}</div>
<p>${esc(tidy(modelLine))} This prohibition applies to every school, program and activity under the Board's authority and to every employee, contractor and volunteer. Nothing in this policy limits the use of reasonable physical force necessary to protect a student or others from imminent harm, to obtain possession of a weapon, or to maintain safety, in accordance with state law.</p></div>
<p class="small">The first sentence is the wording ${m.used_by >= 5 ? `${m.used_by} ${STATE} boards already use` : "most boards use"}; the rest is the standard scope and safety clause. The board's attorney or policy service can fit it to the manual's numbering.</p>

<h2>What follows</h2>
<p>When the board adopts a prohibition and the district sends the adopted text, the district is recognized as a Safe School for the 2026-27 school year: a certificate for the office, a press release the district can send to local media, and its entry in the public record updated the same day.</p>
<p class="small">Contact: Anthony David Adams, EarthPilot · anthony@175g.com · (234) 516-2545 · 11662 Old Lake Road, North East, PA 16428. The Safe Schools Project keeps a public, sourced record of every district's own written rule at earthpilot.org/kids.</p>
<div class="foot"><span>EarthPilot · Safe Schools Project</span><span>Page 2 of 2</span></div>
</div>
</body></html>`;

writeFileSync(out + ".html", html);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: "networkidle" }); await p.waitForTimeout(600);
await p.pdf({ path: out + ".pdf", width: "8.5in", height: "11in", printBackground: true, preferCSSPageSize: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
await p.screenshot({ path: out + ".png", fullPage: true }); await b.close();
console.log(`wrote ${out}.pdf (${name}, ${d.state})`);
