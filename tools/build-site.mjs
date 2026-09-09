// Static site generator for earthpilot.org/kids. Reads site/data/*.json (run build-site-data.mjs first),
// data/crdc/*/states.csv, templates/*.md. Writes site/index.html, site/state/<XX>/index.html, site/resources/index.html, site/contribute/index.html.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const BASE = "https://earthpilot.org/kids";
const REPO = "https://github.com/AnthonyDavidAdams/end-school-corporal-punishment";
const states = JSON.parse(readFileSync(join(site, "data/states.json"), "utf8"));
const districts = JSON.parse(readFileSync(join(site, "data/districts.json"), "utf8"));
const claims = JSON.parse(readFileSync(join(site, "data/claims.json"), "utf8"));
const summary = JSON.parse(readFileSync(join(site, "data/summary.json"), "utf8"));
const csv = t => { const [h, ...r] = t.trim().split(/\r?\n/).map(l => l.split(",")); return r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const crdc = {};
for (const y of readdirSync(join(root, "data/crdc")).filter(f => /^\d{4}-\d{2}$/.test(f))) { const p = join(root, "data/crdc", y, "states.csv"); if (existsSync(p)) crdc[y] = csv(readFileSync(p, "utf8")); }
const national = csv(readFileSync(join(root, "data/crdc/national.csv"), "utf8"));
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = v => v == null || v === "" ? "" : Number(v).toLocaleString("en-US");
const LABEL = { banned: "Prohibited in public schools", partial: "Legal, but every district has stopped", legal: "Legal in public schools" };
const COLOR = { banned: "#2f6b3a", partial: "#c9a227", legal: "#b3382c" };
const claim = id => claims.find(c => c.id === id);
const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");

function shell({ title, description, path, body, image = `${BASE}/assets/og-image.png`, extraHead = "" }) {
  const url = `${BASE}${path}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${image}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="End School Corporal Punishment">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">
<link rel="stylesheet" href="/kids/site.css">
${extraHead}
</head>
<body>
<header class="top"><div class="wrap">
  <a class="wordmark" href="/kids/">End School <span>Corporal Punishment</span></a>
  <nav><a href="/kids/">Map</a><a href="/kids/resources/">Facts &amp; templates</a><a href="/kids/contribute/">Bring an agent</a><a href="${REPO}" rel="noopener">GitHub</a></nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer class="wrap foot">
  <p>End School Corporal Punishment™ is an open project of <a href="https://earthpilot.ai">EarthPilot</a>. Every figure on this site is a file in the <a href="${REPO}/tree/main/facts/claims">claims registry</a> with its source and verification date; data generated ${summary.generated}. Content CC BY 4.0, code MIT. Map boundaries: US Census Bureau (public domain).</p>
  <p>No student is named on this site. Officials' public positions are documented; their private lives are not.</p>
</footer>
</body>
</html>`;
}

// ---------- CSS ----------
writeFileSync(join(site, "site.css"), `
:root{--ink:#1c1c1c;--muted:#5d5a54;--bg:#f4efe6;--card:#fffdf8;--rule:#e2dccf;--green:#2f6b3a;--gold:#c9a227;--red:#b3382c;--navy:#1f3a5f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 -apple-system,system-ui,"Segoe UI",Helvetica,Arial,sans-serif}
a{color:var(--navy)}.wrap{max-width:1100px;margin:0 auto;padding:0 1.25rem}
.top{border-bottom:1px solid var(--rule);background:var(--bg);position:sticky;top:0;z-index:10}.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1.25rem;flex-wrap:wrap}
.wordmark{font-family:Georgia,"Times New Roman",serif;font-size:1.25rem;text-decoration:none;color:var(--ink);letter-spacing:-.01em}.wordmark span{color:var(--red)}
.top nav{display:flex;gap:1.1rem;flex-wrap:wrap}.top nav a{text-decoration:none;color:var(--ink);font-size:.95rem;border-bottom:2px solid transparent}.top nav a:hover{border-color:var(--gold)}
h1{font-family:Georgia,serif;font-size:clamp(1.9rem,4vw,3rem);line-height:1.08;margin:1.6rem 0 .6rem;letter-spacing:-.01em}h2{font-family:Georgia,serif;font-size:1.5rem;margin:2.2rem 0 .7rem}h3{font-size:1.1rem;margin:1.4rem 0 .4rem}
.lede{font-size:1.15rem;color:var(--muted);max-width:60ch;margin:0 0 1.4rem}
.layout{display:grid;grid-template-columns:2fr 1fr;gap:1.5rem;align-items:start}@media(max-width:820px){.layout{grid-template-columns:1fr}}
#map svg{width:100%;height:auto;display:block}#legend{display:flex;flex-wrap:wrap;gap:1rem;font-size:.9rem;margin-top:.6rem}#legend i{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:.4rem;vertical-align:-2px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:1.1rem 1.3rem}.card h2{margin-top:0;font-size:1.3rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin:1.5rem 0}.stat{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:1rem 1.1rem}.stat b{display:block;font-family:Georgia,serif;font-size:2rem;line-height:1.1}.stat span{color:var(--muted);font-size:.9rem}
.status{display:inline-block;padding:.25rem .7rem;border-radius:999px;color:#fff;font-weight:600;font-size:.9rem}.status.banned{background:var(--green)}.status.partial{background:var(--gold);color:#1c1c1c}.status.legal{background:var(--red)}
table{border-collapse:collapse;width:100%;font-size:.95rem;background:var(--card)}th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--rule);vertical-align:top}th{background:#efe9dc;font-weight:600}.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:10px}
.meta{color:var(--muted);font-size:.88rem}.small{font-size:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}
pre{background:#fff;border:1px solid var(--rule);border-radius:8px;padding:1rem;white-space:pre-wrap;font:.85rem/1.5 ui-monospace,Menlo,monospace;overflow-x:auto}.copy{background:var(--navy);color:#fff;border:0;border-radius:6px;padding:.45rem .8rem;cursor:pointer;font-size:.9rem}
.btn{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:.6rem 1rem;border-radius:8px;font-weight:600}.btn.alt{background:var(--green)}
.foot{border-top:1px solid var(--rule);margin-top:3rem;padding-top:1.2rem;padding-bottom:2rem;color:var(--muted);font-size:.88rem}
ul.claims li{margin:.5rem 0}.states-list{columns:3;column-gap:1.5rem;font-size:.95rem}@media(max-width:700px){.states-list{columns:2}}.states-list a{text-decoration:none}
code{background:#efe9dc;padding:.05rem .3rem;border-radius:4px;font-size:.9em}
`.trim());

// ---------- index ----------
const total2122 = claim("crdc-national-total-2021-22"), c2324 = claim("crdc-national-total-2023-24-computed"), top4 = claim("crdc-top-four-states-share-2021-22"), boys = claim("crdc-boys-share-2021-22"), black = claim("crdc-black-students-share-2021-22"), oecd = claim("intl-oecd-36-of-38");
const legalStates = Object.values(states).filter(s => s.status === "legal").sort((a, b) => a.name.localeCompare(b.name));
const partialStates = Object.values(states).filter(s => s.status === "partial");
const bannedStates = Object.values(states).filter(s => s.status === "banned").sort((a, b) => a.name.localeCompare(b.name));
const stateLink = s => `<a href="/kids/state/${s.code}/">${esc(s.name)}</a>`;
writeFileSync(join(site, "index.html"), shell({
  title: "Where a teacher may still legally hit a student", path: "/",
  description: "The open map of corporal punishment in US public schools: 15 states still use it, 24,534 students struck in 2021-22. Every figure sourced. Bring an agent and help end it.",
  extraHead: `<script defer src="/kids/map.js"></script>`,
  body: `
<h1>Where a teacher may still legally hit a student</h1>
<p class="lede">In ${legalStates.length} states a public school employee may paddle a child as punishment, and does. In ${partialStates.length} more it is legal but every district has stopped. Hover or tap a state. Every status links to its statute and every number to its source.</p>
<div class="layout">
  <div><div id="map" aria-live="polite"></div><div id="legend"></div></div>
  <aside id="info" class="card"><p class="meta">Select a state to see its law, limits, bills, and the number of students struck.</p></aside>
</div>
<div class="stats">
  <div class="stat"><b>${n(total2122.figure)}</b><span>students received corporal punishment in 2021-22, the newest year the Department of Education has analyzed</span></div>
  <div class="stat"><b>${n(c2324.figure)}</b><span>in 2023-24, computed by this project from the raw file released August 31, 2026</span></div>
  <div class="stat"><b>${top4.figure}%</b><span>of them in four states: Texas, Alabama, Mississippi, Arkansas</span></div>
  <div class="stat"><b>${Math.round(boys.figure)}%</b><span>boys. Black students are ${Math.round(black.figure)}% of those struck and 15% of enrollment</span></div>
  <div class="stat"><b>36 of 38</b><span>OECD countries prohibit it in schools. The exceptions: the United States and one Australian state</span></div>
</div>
<p class="meta">Sources: US Department of Education Civil Rights Data Collection; Global Initiative to End All Corporal Punishment of Children (March 2025). Counts are students, not incidents, self-reported by districts the Department says likely underreport. <a href="/kids/resources/#facts">All claims with sources.</a></p>
<h2>Still legal and in use</h2>
<p class="states-list">${legalStates.map(stateLink).join("<br>")}</p>
<h2>Legal, but every district has stopped</h2>
<p>${partialStates.map(stateLink).join(", ")}. Kentucky reached zero through a 2022 state board regulation; North Carolina through twenty years of district-by-district work.</p>
<h2>How it ends</h2>
<div class="grid">
  <div class="card"><h2>If you are a parent</h2><p>In every state where this is legal you can refuse in writing. <a href="/kids/resources/#letters">The letter takes two minutes.</a> Districts change policy when the pile of refusals gets tall.</p></div>
  <div class="card"><h2>If you have an AI agent</h2><p>Most of the remaining work is reading district policy manuals and recording what they say, with sources. About 4,400 districts; ${summary.districts_sourced} sourced so far. <a href="/kids/contribute/">Install the skills and take a state.</a></p></div>
  <div class="card"><h2>If you run a school</h2><p>A free, open ten-module curriculum for replacing corporal punishment, written for small schools with no behavior specialist. <a href="${REPO}/tree/main/training" rel="noopener">Read the training.</a></p></div>
</div>
<h2>Prohibited</h2>
<p class="states-list">${bannedStates.map(s => `${stateLink(s)}${s.year_banned ? ` <span class="meta">${s.year_banned}</span>` : ""}`).join("<br>")}</p>
`}));

// ---------- state pages ----------
for (const s of Object.values(states)) {
  const rows = Object.entries(crdc).map(([y, t]) => [y, t.find(r => r.state === s.code)]).filter(([, r]) => r);
  const ds = (districts[s.code] || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const legal = s.status !== "banned";
  const body = `
<p class="meta"><a href="/kids/">Map</a> › ${esc(s.name)}</p>
<h1>${esc(s.name)}</h1>
<p><span class="status ${s.status}">${LABEL[s.status]}${s.year_banned ? ` since ${s.year_banned}` : ""}</span></p>
${s.notes ? `<p class="lede">${esc(s.notes)}</p>` : ""}
<div class="grid">
<div class="card"><h2>The law</h2>
${s.statute ? `<p><b>${esc(s.statute)}</b>${s.statute_url ? ` <a href="${esc(s.statute_url)}" rel="noopener">text</a>` : ""}</p>` : `<p class="meta">Statute not yet verified against a primary source. <a href="${REPO}/blob/main/data/states/${s.code}.yaml">Help verify it.</a></p>`}
${s.private_schools_covered === true ? "<p>Private schools are also covered.</p>" : s.private_schools_covered === false ? "<p>Private schools are not covered.</p>" : ""}
${s.limits && s.limits.length ? `<h3>Limits</h3><ul>${s.limits.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : legal ? "<p>No statutory limits: no consent requirement, no disability exemption, no witness or record rules.</p>" : ""}
${s.bills && s.bills.length ? `<h3>Bills</h3><ul>${s.bills.map(b => `<li><b>${esc(b.number)}</b> (${esc(b.session)})${b.sponsor ? `, ${esc(b.sponsor)}` : ""}: ${esc(b.summary)} <span class="meta">${esc(b.status)}</span> <a href="${esc(b.url)}" rel="noopener">record</a></li>`).join("")}</ul>` : ""}
${s.sources && s.sources.length ? `<p class="meta">Sources: ${s.sources.map((u, i) => `<a href="${esc(u)}" rel="noopener">${i + 1}</a>`).join(" ")}${s.last_verified ? ` · verified ${s.last_verified}` : ""}</p>` : ""}
</div>
<div class="card"><h2>Students struck</h2>
${rows.length ? `<div class="tablewrap"><table><tr><th>Year</th><th>Students</th><th>Black</th><th>Boys</th><th>With disabilities</th><th>Per 1,000</th></tr>${rows.map(([y, r]) => `<tr><td>${y}</td><td>${n(r.students)}</td><td>${n(r.black)}</td><td>${n(r.boys)}</td><td>${n(r.with_disabilities)}</td><td>${r.per_1000_enrolled || ""}</td></tr>`).join("")}</table></div><p class="meta">US Department of Education Civil Rights Data Collection. Students, not incidents; 2023-24 computed by this project from the raw file. ${s.code === "NJ" ? "The 2023-24 New Jersey figure is an evident district reporting error." : ""}</p>` : `<p>No students reported in the federal collections since 2017-18.</p>`}
</div>
</div>
${legal ? `<h2>Districts</h2>
<p class="meta">${ds.length} districts recorded; ${ds.filter(d => d.source).length} with a source. A status without a source has not been verified. <a href="/kids/contribute/">Help scan this state.</a></p>
${ds.length ? `<div class="tablewrap"><table><tr><th>District</th><th>County</th><th>Policy</th><th>Source</th><th>Verified</th></tr>${ds.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.county || "")}</td><td>${{ allows: "Allows", bans: "Prohibits", consent_required: "Parental consent required", unknown: "Unknown" }[d.status]}</td><td>${d.source ? `<a href="${esc(d.source)}" rel="noopener">${esc(d.policy_code || "policy")}</a>` : "<span class=\"meta\">none yet</span>"}</td><td class="meta">${d.last_verified || ""}</td></tr>`).join("")}</table></div>` : ""}` : ""}
<h2>Do something</h2>
<div class="grid">
${legal ? `<div class="card"><h2>Parents</h2><p><a href="/kids/resources/#letters">File the written refusal</a> with your child's school. ${s.code === "LA" || s.code === "MO" || s.code === "FL" ? "In this state the school also needs your signed consent before any paddling." : "In this state the burden is on you to say no; the school must honor it."}</p></div>` : ""}
<div class="card"><h2>Everyone</h2><p><a href="/kids/resources/#letters">Write the board or your legislator</a> with the numbers above. The templates cite only verified facts.</p></div>
<div class="card"><h2>Agents</h2><p>Every district in this state needs a sourced policy entry. <a href="/kids/contribute/">The district scan takes about an hour per 40 districts.</a></p></div>
</div>`;
  mkdirSync(join(site, "state", s.code), { recursive: true });
  writeFileSync(join(site, "state", s.code, "index.html"), shell({ title: `${s.name}: corporal punishment in schools`, path: `/state/${s.code}/`, description: `${s.name}: ${LABEL[s.status].toLowerCase()}${s.year_banned ? ` since ${s.year_banned}` : ""}. ${rows.length ? `${n(rows[rows.length - 1][1].students)} students struck in ${rows[rows.length - 1][0]}.` : ""} Law, limits, bills, districts, sources.`, body }));
}

// ---------- resources ----------
const verified = claims.filter(c => c.status === "verified");
const groups = [["The numbers", ["crdc", "national"]], ["States and the law", ["law", "states"]], ["Campaigns that worked", ["campaign"]], ["The research", ["study", "harm"]], ["What works instead", ["alternatives"]], ["The rest of the world", ["international"]], ["Who has taken a position", ["organizations"]], ["Courts", ["courts", "litigation"]]];
const used = new Set();
const claimHtml = c => { used.add(c.id); const src = (c.sources || []).find(s => s.primary) || (c.sources || [])[0]; return `<li>${esc(c.claim)} <span class="meta">${c.as_of ? `(${esc(c.as_of)}) ` : ""}${src ? `<a href="${esc(src.url)}" rel="noopener">source</a>` : ""} · <a href="${REPO}/blob/main/facts/claims/${c.id}.md">file</a></span></li>`; };
const facts = groups.map(([t, tags]) => { const cs = verified.filter(c => !used.has(c.id) && (c.tags || []).some(x => tags.includes(x))); return cs.length ? `<h3>${t}</h3><ul class="claims">${cs.map(claimHtml).join("")}</ul>` : ""; }).join("");
const templates = readdirSync(join(root, "templates")).filter(f => f.endsWith(".md")).map(f => { const t = readFileSync(join(root, "templates", f), "utf8"); const title = (t.match(/^# (.+)$/m) || [, f])[1]; const intro = t.split("```")[0].split("\n").slice(1).join(" ").trim(); const code = (t.match(/```\n([\s\S]*?)\n```/) || [, ""])[1]; return { f, title, intro, code }; });
writeFileSync(join(site, "resources", "index.html").replace(/resources\/index/, (mkdirSync(join(site, "resources"), { recursive: true }), "resources/index")), shell({
  title: "Facts and templates to end school corporal punishment", path: "/resources/",
  description: "Every verified fact about corporal punishment in US schools with its source, plus the model bill, district policy, board resolution, parent refusal letter, testimony and records-request templates.",
  extraHead: `<script>function copyT(b){navigator.clipboard.writeText(b.previousElementSibling.innerText).then(()=>{const t=b.innerText;b.innerText='Copied';setTimeout(()=>b.innerText=t,1500)})}</script>`,
  body: `
<h1>Facts and templates</h1>
<p class="lede">Every sentence below is a file in the claims registry with its primary source and the date it was last verified. Quote the year with the number. If one is wrong, <a href="${REPO}/issues/new?template=fact-correction.yml">say so</a> and it will be fixed the same day.</p>
<h2 id="facts">Verified facts</h2>
${facts}
<h2 id="letters">Templates</h2>
<p>Placeholders are in [BRACKETS]. Facts cited inside the templates come from the registry above.</p>
${templates.map(t => `<h3 id="${t.f.replace(".md", "")}">${esc(t.title)}</h3>${t.intro ? `<p class="small">${md(t.intro)}</p>` : ""}<pre>${esc(t.code)}</pre><button class="copy" onclick="copyT(this)">Copy</button>`).join("")}
<h2>Strategy, training, and the rest</h2>
<ul>
<li><a href="${REPO}/blob/main/strategy/README.md">Theory of change and playbooks</a>: district, state, narrowing, replacement, federal, persuasion.</li>
<li><a href="${REPO}/tree/main/strategy/case-studies">Case studies</a>: Colorado, Idaho, New Mexico, Kentucky's regulation, North Carolina, Florida's consent law, Oklahoma, Wyoming, the federal bills.</li>
<li><a href="${REPO}/blob/main/strategy/opposition.md">Every argument for paddling heard in testimony</a>, and what has answered it.</li>
<li><a href="${REPO}/blob/main/strategy/liability.md">Liability</a>: what courts actually do, including the Fifth Circuit rule.</li>
<li><a href="${REPO}/tree/main/training">The training</a>: ten modules for replacing corporal punishment in a small school, against <a href="${REPO}/blob/main/training/evidence.md">48 sources</a>.</li>
<li><a href="${REPO}/tree/main/share">Share kits</a>: images in the visual language of the communities that still paddle.</li>
</ul>`}));

// ---------- contribute ----------
mkdirSync(join(site, "contribute"), { recursive: true });
writeFileSync(join(site, "contribute", "index.html"), shell({
  title: "Bring an agent: help end school corporal punishment", path: "/contribute/",
  description: "Point your AI agent at the open task queue: scan district policies, verify claims, watch bills. Or give money, share your state, or file the parent letter.",
  body: `
<h1>Bring an agent</h1>
<p class="lede">Most of the remaining work is reading thousands of district policy manuals and recording what they say, with a source and a verbatim quote. That is agent work, and the tools are ready.</p>
<div class="grid">
<div class="card"><h2>Claude Code</h2><pre>claude plugin marketplace add AnthonyDavidAdams/end-school-corporal-punishment
claude plugin install escp@escp
claude
&gt; /escp:district-policy-scan Mississippi</pre><p class="small">Six skills: district scan, verify claim, bill watch, federal data refresh, decision-maker dossier, share kit. Each ends in a validated pull request.</p></div>
<div class="card"><h2>Any other agent (MCP)</h2><pre>https://escp-mcp-production.up.railway.app/mcp</pre><p class="small">A Model Context Protocol server with the facts, state law, district data, federal counts, the task queue, and tools to submit a district finding or a fact correction. Works from ChatGPT, Cursor, Claude Desktop, or your own code. <a href="${REPO}/blob/main/mcp/README.md">Setup.</a></p></div>
<div class="card"><h2>The contract</h2><p>Open every source. Quote verbatim. Date everything. Never guess. No student names. <a href="${REPO}/blob/main/AGENTS.md">AGENTS.md</a> is the whole of it, and the validator enforces the schema.</p></div>
</div>
<h2>The queue</h2>
<div class="tablewrap"><table><tr><th>Task</th><th>Unit</th><th>Priority</th></tr>
<tr><td>District policy scan</td><td>One state, or a slice of Texas</td><td>1</td></tr>
<tr><td>Federal data refresh</td><td>One CRDC release year</td><td>1</td></tr>
<tr><td>Verify a claim</td><td>One claim file</td><td>2</td></tr>
<tr><td>Bill watch</td><td>One state, current session</td><td>2</td></tr>
<tr><td>Decision-maker dossier</td><td>One board or committee, public record only</td><td>3</td></tr>
<tr><td>Training review</td><td>One module, by someone who has run a school</td><td>3</td></tr>
</table></div>
<p class="meta">Claim a scope first with the <a href="${REPO}/issues/new?template=task-claim.yml">task-claim issue</a> so work is not duplicated. Roughly 4,400 districts in the 17 states; ${summary.districts_sourced} sourced so far.</p>
<h2>No agent?</h2>
<div class="grid">
<div class="card"><h2>Money</h2><p>Compute for the queue, public-records fees, and travel to hearings, in that order, with a <a href="${REPO}/blob/main/FUNDING.md">public ledger</a>. Sponsor the repository on GitHub.</p></div>
<div class="card"><h2>Your network</h2><p>Share your state's page. If you are a teacher, physician, psychologist, pastor or lawyer in a paddling state, open an issue titled <code>[witness] Your State</code>.</p></div>
<div class="card"><h2>An hour</h2><p>Add your own district's policy with the <a href="${REPO}/issues/new?template=district-policy.yml">district finding form</a>, or verify one claim.</p></div>
</div>`}));

// ---------- htaccess ----------
writeFileSync(join(site, ".htaccess"), `RewriteEngine On
RewriteBase /kids/
# old PHP URLs
RewriteCond %{QUERY_STRING} ^state=([A-Za-z]{2})
RewriteRule ^(county|state)(\\.php)?$ /kids/state/%1/? [R=301,L]
RewriteRule ^resources(\\.php)?$ /kids/resources/ [R=301,L]
RewriteRule ^(index\\.php)$ /kids/ [R=301,L]
<FilesMatch "^\\.">
  Require all denied
</FilesMatch>
<FilesMatch "\\.(db|sqlite|sql|yaml|yml)$">
  Require all denied
</FilesMatch>
AddType image/svg+xml .svg
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType image/svg+xml "access plus 7 days"
  ExpiresByType application/json "access plus 1 hour"
</IfModule>
`);
console.log(`built index, ${Object.keys(states).length} state pages, resources, contribute`);
