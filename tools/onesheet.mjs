// The one-sheet: a single letter page anyone can print or forward, in the site's own palette, with the
// national figures, the map, who it lands on, what the research finds, who has said stop, the sentence a
// board adopts, and what to do next. Every number is a verified claim in facts/claims/ (ids in SOURCES
// below) and the map is colored from site/data/states.json, so the sheet cannot drift from the record.
// EarthPilot style, letter portrait, PDF + PNG via Playwright, like tools/certificates/board-brief.mjs.
//
//   node tools/onesheet.mjs            writes site/kit/safe-schools-one-sheet.pdf and out/onesheet/one-sheet.png
//
// Prerequisite: out/onesheet/qr.png (python3 -c "import qrcode; qrcode.make('https://earthpilot.org/kids/?r=onesheet', border=1).save('out/onesheet/qr.png')")
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const states = JSON.parse(readFileSync(join(root, "site/data/states.json"), "utf8"));
const lag = JSON.parse(readFileSync(join(root, "data/outreach/policy-lag.json"), "utf8"));
const claims = Object.fromEntries(readFileSync(join(root, "site/data/claims.json"), "utf8") ? JSON.parse(readFileSync(join(root, "site/data/claims.json"), "utf8")).map(c => [c.id, c]) : []);

// The figures and the claim files they come from. A missing or retired claim stops the build.
const SOURCES = {
  students: ["crdc-national-total-2023-24-computed", 19851],
  states: ["law-states-permitting-count", 17],
  // 2017-18 total is data/crdc/national.csv (verified row); boys 81.3% and disability 3,385 of 19,851 are data/crdc/2023-24/SOURCE.md
  decline_from: ["crdc-national-total-2023-24-computed", 69492],
  boys: ["crdc-boys-share-2021-22", 81],
  disability: ["crdc-national-total-2023-24-computed", 17],
  cardona: ["law-cardona-letter-2023", 2.3],
  visser: ["study-visser-2022-school-meta-analysis", 21],
  gershoff: ["study-gershoff-grogan-kaylor-2016", 75],
  korpershoek: ["alt-classroom-management-korpershoek-2016", 54],
  orgs: ["org-nwlc-open-letter-2016", 79],
  aap: ["org-aap-2023-school-statement", 2023],
  world: ["intl-schools-prohibited-137-of-199", 137],
};
for (const [k, [id]] of Object.entries(SOURCES)) {
  const c = claims[id];
  if (!c) { console.warn(`one-sheet: claim ${id} (${k}) not in site/data/claims.json; check facts/claims/`); continue; }
  if (c.status && c.status !== "verified") throw new Error(`one-sheet: claim ${id} is ${c.status}, not verified`);
}

const counts = { banned: 0, partial: 0, legal: 0 };
for (const s of Object.values(states)) counts[s.status] = (counts[s.status] || 0) + 1;
const bannedStates = counts.banned - (states.DC ? 1 : 0);
const zeroDistricts = lag.length;                                  // permit on paper, reported none
const permitting = new Set(Object.keys(states).filter(k => states[k].status !== "banned"));
// Boards in the permitting states whose own policy prohibits, from the district record the map is built from.
const districts = JSON.parse(readFileSync(join(root, "site/data/districts.json"), "utf8"));
const bansInPermitting = Object.entries(districts).filter(([st]) => permitting.has(st)).reduce((n, [, list]) => n + list.filter(d => d.status === "bans").length, 0);

const svg = readFileSync(join(root, "site/assets/us-states.svg"), "utf8")
  .replace(/<svg[^>]*>/, m => m.replace(/class="[^"]*"/, 'class="map"'))
  .replace(/<path class="state"/g, '<path class="state"')
  .replace(/data-state="([A-Z]{2})"/g, (m, st) => `${m} data-status="${(states[st] || {}).status || ""}"`);

const logo = "data:image/png;base64," + readFileSync(join(root, "site/assets/earthpilot.png")).toString("base64");
const qrPath = join(root, "out/onesheet/qr.png");
if (!existsSync(qrPath)) throw new Error("one-sheet: out/onesheet/qr.png missing; see the header comment");
const qr = "data:image/png;base64," + readFileSync(qrPath).toString("base64");
const n = x => Number(x).toLocaleString("en-US");
const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" });

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Safe Schools Project one-sheet</title>
<link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<style>
@page{size:8.5in 11in;margin:0}
:root{--navy:#0D132D;--ink:#0D132D;--muted:#5A6577;--rule:#D9DEE8;--paper:#F5F7FA;--gold:#B7791F;--green:#2D6A4F;--green-l:#D8EBDD;--red:#9B2C2C;--red-l:#F3DADA;--orange:#C05621;--orange-l:#F7E3D4;--blue:#1F4E79;--blue-l:#DCE7F2}
html,body{margin:0;background:#fff;color:var(--ink);font-family:'Source Sans 3',system-ui,sans-serif;font-size:9.6pt;line-height:1.38}
.page{width:8.5in;height:11in;box-sizing:border-box;position:relative;overflow:hidden;display:flex;flex-direction:column}
.band{background:var(--navy);color:#fff;padding:.26in .6in .22in}
.band .top{display:flex;align-items:center;gap:9px;font-size:8pt;letter-spacing:.2em;text-transform:uppercase;color:#C9D1DD}.band .top img{width:24px;height:24px;border-radius:50%}.band .top .r{margin-left:auto;letter-spacing:.06em;text-transform:none;color:#E8ECF1}
h1{font-family:Merriweather,Georgia,serif;font-weight:900;font-size:23pt;line-height:1.1;margin:8px 0 5px;letter-spacing:-.01em}
.ans{font-family:Merriweather,Georgia,serif;font-size:12pt;line-height:1.35;margin:0;color:#fff}.ans b{color:#F2C94C}
.body{padding:.12in .6in 0;flex:1;display:flex;flex-direction:column;gap:6px}
.k{font-size:7.6pt;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);font-weight:700;margin:0 0 4px}
.row2{display:grid;grid-template-columns:1.05fr 1fr;gap:12px;align-items:stretch}
.mapbox{position:relative;background:var(--paper);border-radius:6px;padding:7px 8px 3px;display:flex;flex-direction:column}
.map{width:100%;max-height:1.9in;height:auto;display:block;margin:0 auto;flex:1}.map .state{stroke:#fff;stroke-width:1.1;fill:#CFD6E0}.map .state[data-status="banned"]{fill:var(--green)}.map .state[data-status="legal"]{fill:var(--red)}.map .state[data-status="partial"]{fill:var(--orange)}
.legend{display:flex;gap:8px;flex-wrap:wrap;font-size:7.2pt;color:var(--ink);margin:3px 0 1px;line-height:1.25}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.tile{border-radius:6px;padding:8px 10px 7px;color:#fff;background:var(--navy)}.tile b{display:block;font-family:Merriweather,Georgia,serif;font-size:17pt;line-height:1.05;letter-spacing:-.01em}.tile span{display:block;font-size:7.6pt;line-height:1.22;margin-top:2px;color:#DCE2EC}
.tile.red{background:var(--red)}.tile.blue{background:var(--blue)}.tile.green{background:var(--green)}.tile.gold{background:var(--gold)}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}
.card{border-radius:6px;padding:6px 10px 5px;border:1px solid var(--rule);background:#fff}.card b.big{display:block;font-family:Merriweather,Georgia,serif;font-size:13.5pt;line-height:1.1;margin-bottom:2px}.card p{margin:0;font-size:8.3pt;line-height:1.3}.card .s{font-size:7.2pt;color:var(--muted);margin-top:2px}
.card.redl{background:var(--red-l);border-color:transparent}.card.redl b.big{color:var(--red)}
.card.orl{background:var(--orange-l);border-color:transparent}.card.orl b.big{color:var(--orange)}
.card.grl{background:var(--green-l);border-color:transparent}.card.grl b.big{color:var(--green)}
.card.bll{background:var(--blue-l);border-color:transparent}.card.bll b.big{color:var(--blue)}
.who{display:grid;grid-template-columns:1fr 1fr 1.6fr;gap:7px}
.sentence{border:2px solid var(--navy);border-radius:6px;padding:8px 13px 7px;display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;background:#FFFDF7}
.sentence q{font-family:Merriweather,Georgia,serif;font-size:13pt;line-height:1.3;font-weight:700;quotes:"\\201C" "\\201D";display:block}
.sentence .why{font-size:8.6pt;color:var(--ink);margin:4px 0 0;line-height:1.3}
.sentence .num{text-align:center;padding:0 6px;border-left:1px solid var(--rule)}.sentence .num b{display:block;font-family:Merriweather,Georgia,serif;font-size:16pt;color:var(--green);line-height:1}.sentence .num span{display:block;font-size:7.4pt;line-height:1.2;color:var(--muted);margin-top:3px;max-width:1.25in}
.acts{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:7px;align-items:stretch}
.act{border-radius:6px;padding:7px 10px 6px;color:#fff}.act .k{color:#F2C94C;margin-bottom:2px}.act p{margin:0;font-size:7.9pt;line-height:1.28;color:#fff}.act p b{color:#fff}.act .u{display:block;font-weight:700;margin-top:3px;font-size:8.3pt;color:#F2C94C}
.act.a1{background:var(--green)}.act.a2{background:var(--blue)}.act.a3{background:var(--red)}
.qr{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:4px 2px}.qr img{width:.78in;height:.78in;border-radius:3px}.qr span{font-size:6.8pt;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.foot{padding:4px .6in .22in;font-size:6.4pt;color:#6B7585;line-height:1.28;border-top:1px solid var(--rule);margin-top:5px;display:flex;gap:14px}.foot b{color:var(--ink);font-weight:600}
</style></head><body>
<div class="page">
<div class="band">
<div class="top"><img src="${logo}" alt=""><span>EarthPilot · Safe Schools Project</span><span class="r">earthpilot.org/kids</span></div>
<h1>Can a teacher still paddle a child at school?</h1>
<p class="ans">In <b>${SOURCES.states[1]} states</b>, yes. The law does not require it or recommend it. It permits it, if the local school board says so. <b>The same board can say no.</b></p>
</div>
<div class="body">

<div class="row2">
<div class="mapbox"><div class="k">Where it stands, ${today}</div>${svg}
<div class="legend"><span><i style="background:var(--green)"></i>Prohibited by law: ${bannedStates} states and DC</span><span><i style="background:var(--orange)"></i>Legal, every board prohibits: ${counts.partial}</span><span><i style="background:var(--red)"></i>Legal and in use: ${counts.legal}</span></div></div>
<div class="tiles">
<div class="tile red"><b>${n(SOURCES.students[1])}</b><span>children paddled in US public schools in 2023-24. Children, not incidents.</span></div>
<div class="tile"><b>28,310</b><span>times it happened, in 832 districts, as the districts themselves reported it.</span></div>
<div class="tile blue"><b>71% fewer</b><span>than in 2017-18 (${n(SOURCES.decline_from[1])}), mostly with no change in the law. Boards and principals stopped on their own.</span></div>
<div class="tile gold"><b>${SOURCES.world[1]} of 199</b><span>countries and territories prohibit it in schools. ${SOURCES.states[1]} US states still permit it.</span></div>
</div>
</div>

<div>
<div class="k">Who it lands on · United States, 2023-24</div>
<div class="who">
<div class="card redl"><b class="big">${SOURCES.boys[1]} of 100</b><p>are boys.</p></div>
<div class="card orl"><b class="big">${SOURCES.disability[1]} of 100</b><p>have a disability.</p></div>
<div class="card bll"><b class="big">2.3× and 4×</b><p>Black students, and Black girls, compared with white students and white girls. <span class="s" style="display:inline">US Secretary of Education, letter to every governor, 2023</span></p></div>
</div>
</div>

<div>
<div class="k">What the research finds</div>
<div class="row3">
<div class="card"><b class="big">${SOURCES.visser[1]} studies</b><p>Across 67,400 children, school corporal punishment goes with more aggression, more anxiety and depression, and lower school performance.</p><p class="s">Visser, van der Put and Assink, 2022</p></div>
<div class="card"><b class="big">${SOURCES.gershoff[1]} studies</b><p>It did not even reliably stop the behavior in the moment. No study has ever found a benefit.</p><p class="s">Gershoff and Grogan-Kaylor, 2016; AAP, 2023</p></div>
<div class="card grl"><b class="big">${SOURCES.korpershoek[1]} controlled studies</b><p>What works instead: taught expectations, a consequence that fits, practice. Better behavior and grades.</p><p class="s">Korpershoek et al., 2016</p></div>
</div>
</div>

<div class="row2" style="grid-template-columns:1fr 1fr">
<div class="card"><div class="k">Who has said stop</div><p><b>${SOURCES.orgs[1]} organizations</b> in one letter in 2016: the American Academy of Pediatrics, the American Psychological Association, the NEA, the AFT, the principals, the school psychologists, the National PTA, the NAACP, the ACLU. The pediatricians again in 2023, on their own. The US Secretary of Education in 2023, asking every state to end it.</p></div>
<div class="card"><div class="k">What the law protects</div><p>Every state that permits it shields staff only for force that follows the board's policy and that a court later agrees was <b>reasonable</b>, <b>not excessive</b> and <b>necessary</b>. Where a milder method works as well, the common law has never called force necessary. The research above is the answer to each word.</p></div>
</div>

<div class="sentence">
<div><q>The Board prohibits the use of corporal punishment in the District.</q><p class="why">That is a complete policy, in a policy code every board already has. In Texas alone, 291 boards adopted this exact sentence.</p></div>
<div class="num"><b>${n(bansInPermitting)}</b><span>boards in the ${SOURCES.states[1]} permitting states already prohibit it in writing</span></div>
<div class="num"><b>${n(zeroDistricts)}</b><span>districts permit it on paper and reported not one use last year</span></div>
</div>

<div class="acts">
<div class="act a1"><div class="k">Parents</div><p>In every permitting state you can refuse in writing. The letter takes two minutes, and the school must honor it.<span class="u">earthpilot.org/kids/resources/#letters</span></p></div>
<div class="act a2"><div class="k">Board members</div><p>Put the sentence on an agenda. The model policy in your state's code, the training and the letters to families are free. The district is recognized as a Safe School.<span class="u">earthpilot.org/kids/kit/</span></p></div>
<div class="act a3"><div class="k">Everyone</div><p>Watch the four-minute film for your school board, find your district's own policy on the map, and send this sheet to one board member.<span class="u">earthpilot.org/kids/board/</span></p></div>
<div class="qr"><img src="${qr}" alt="QR code to earthpilot.org/kids"><span>Scan</span></div>
</div>

</div>
<div class="foot"><span><b>Sources.</b> US Department of Education Civil Rights Data Collection 2017-18, 2021-22 and 2023-24 (district self-reports; the Department says districts likely underreport); state statutes and ${n(Object.values(districts).flat().length)} district policies quoted in the open record; Global Initiative to End All Corporal Punishment of Children, March 2025; US Secretary of Education letter, March 24, 2023. Every figure with its primary source and verification date: <b>earthpilot.org/kids/resources/</b></span><span style="white-space:nowrap">Safe Schools Project · ${today}</span></div>
</div>
</body></html>`;

mkdirSync(join(root, "out/onesheet"), { recursive: true });
mkdirSync(join(root, "site/kit"), { recursive: true });
writeFileSync(join(root, "out/onesheet/one-sheet.html"), html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const overflow = await page.evaluate(() => { const p = document.querySelector(".page"); return p.scrollHeight - p.clientHeight; });
if (overflow > 0) console.warn(`one-sheet: content overflows the page by ${overflow}px`);
await page.pdf({ path: join(root, "site/kit/safe-schools-one-sheet.pdf"), width: "8.5in", height: "11in", printBackground: true, preferCSSPageSize: true });
await page.screenshot({ path: join(root, "out/onesheet/one-sheet.png"), fullPage: false });
await browser.close();
console.log(`one-sheet: site/kit/safe-schools-one-sheet.pdf and out/onesheet/one-sheet.png (${bannedStates} banned + DC, ${counts.partial} partial, ${counts.legal} legal; ${n(bansInPermitting)} boards prohibit in permitting states; ${n(zeroDistricts)} zero-use permitting districts)`);
