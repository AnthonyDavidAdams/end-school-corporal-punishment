// Static site generator for earthpilot.org/kids. Reads site/data/*.json (run build-site-data.mjs first),
// data/crdc/*/states.csv, templates/*.md. Writes site/index.html, site/state/<XX>/index.html, site/resources/index.html, site/contribute/index.html.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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

// Cache-busting for the assets the pages reference. Without this a returning visitor keeps running
// whatever JavaScript their browser cached last time: the HTML updates, the behaviour does not, and
// the two disagree in ways that look like the feature is simply broken. Hash is taken lazily because
// site.css is generated later in this same script.
const verCache = {};
const ver = (name) => {
  if (verCache[name]) return verCache[name];
  const f = join(site, name);
  const h = existsSync(f) ? createHash("sha1").update(readFileSync(f)).digest("hex").slice(0, 8) : String(Date.now());
  return (verCache[name] = h);
};
const crdc = {};
for (const y of readdirSync(join(root, "data/crdc")).filter(f => /^\d{4}-\d{2}$/.test(f))) { const p = join(root, "data/crdc", y, "states.csv"); if (existsSync(p)) crdc[y] = csv(readFileSync(p, "utf8")); }
const national = csv(readFileSync(join(root, "data/crdc/national.csv"), "utf8"));

// How many districts each state has, from the federal district file. The site used to say "about
// 4,400 districts" as a flat assertion; it is 5,548, and on a project whose whole claim is that every
// figure is sourced, a rounded guess that is a thousand out is not a small thing. Derived here so it
// moves when the data does.
const leaCounts = Object.fromEntries(csv(readFileSync(join(root, "data/nces/lea-counts-2023-24.csv"), "utf8")).map(r => [r.state, Number(r.total)]));
const districtsIn = codes => codes.reduce((a, c) => a + (leaCounts[c] || 0), 0);
// ---- county map: parse the public-domain SVG once, build a per-state county SVG ----
const usSvg = readFileSync(join(site, "assets/us-map.svg"), "utf8");
const countyPaths = [...usSvg.matchAll(/<path class="county" data-fips="(\d+)" data-state="([A-Z]{2})" data-name="([^"]*)" d="([^"]*)"\/>/g)].map(m => ({ fips: m[1], state: m[2], name: m[3], d: m[4] }));
const statePaths = Object.fromEntries([...usSvg.matchAll(/<path class="state" id="state-([A-Z]{2})"[^>]*? d="([^"]*)">/g)].map(m => [m[1], m[2]]));
const bbox = ds => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const d of ds) for (const m of d.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)) { const x = +m[1], y = +m[2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1 - x0, y1 - y0]; };
const norm = c => String(c || "").toLowerCase().replace(/&amp;/g, "&").replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/i, "").replace(/^st\.\s/, "st ").replace(/^saint\s/, "st ").replace(/[^a-z0-9 ]/g, "").trim();
const COUNTY_COLOR = { allows: "#9B2C2C", consent_required: "#C05621", bans: "#2D6A4F", unknown: "#B85C5C", none: "#C98383" };
function countyStatus(code, list) {
  const base = states[code].status;
  if (!list.length) return base === "banned" ? "bans" : base === "partial" ? "bans" : "state";
  if (list.some(d => d.status === "allows")) return "allows";
  if (list.some(d => d.status === "consent_required")) return "consent_required";
  if (list.every(d => d.status === "bans")) return "bans";
  return "unknown";
}
const CFILL = { allows: "#9B2C2C", consent_required: "#C05621", bans: "#2D6A4F", unknown: "#B0A8A0", state: "#C98383" };
const CLBL = { allows: "A district's policy allows it", consent_required: "Parental consent required", bans: "Every sourced district prohibits it", unknown: "District policy not yet checked", state: "No district recorded yet: state law applies" };
function countyMap(code, ds) {
  const cps = countyPaths.filter(c => c.state === code); if (!cps.length) return "";
  const s = states[code];
  const byCounty = {}; for (const d of ds) { const k = norm(d.county); if (!k) continue; (byCounty[k] ||= []).push(d); }
  const [x, y, w, h] = bbox(cps.map(c => c.d)); const pad = Math.max(w, h) * 0.03; const sw = (Math.max(w, h) / 700).toFixed(2);
  const counts = {};
  const paths = cps.map(c => { const list = byCounty[norm(c.name)] || []; const st = countyStatus(code, list); counts[st] = (counts[st] || 0) + 1;
    const label = list.length ? list.map(d => `${d.name}: ${({ allows: "allows", bans: "prohibits", consent_required: "consent required", unknown: "policy unknown" })[d.status]}`).join("<br>") : "No district recorded yet. State law applies. Help scan it.";
    return `<path d="${c.d}" fill="${CFILL[st]}" stroke="#fff" stroke-width="${sw}" data-county="${esc(c.name)}" data-status="${esc(CLBL[st])}" data-districts="${esc(label)}" data-key="${esc(norm(c.name))}" tabindex="0"><title>${esc(c.name)}</title></path>`; }).join("\n");
  return `<div class="mapbox"><div class="mapctl"><input id="dsearch" type="search" placeholder="Find a district or county" aria-label="Find a district or county"><label class="dlines"><input type="checkbox" id="dlines" checked> School district lines</label>
<span class="meta">${esc(s.name)} has ${cps.length} counties and ${leaCounts[code] ? n(leaCounts[code]) : "many"} school districts; the map is counties, and policy is set district by district. Hover one for its districts; click to jump to the table.</span></div>
<svg viewBox="${(x - pad).toFixed(1)} ${(y - pad).toFixed(1)} ${(w + 2 * pad).toFixed(1)} ${(h + 2 * pad).toFixed(1)}" class="countymap" data-state="${code}" role="img" aria-label="Counties colored by school district corporal punishment policy">
${paths}
<path d="${statePaths[code]}" fill="none" stroke="#0D132D" stroke-width="${(Math.max(w, h) / 450).toFixed(2)}" pointer-events="none"/>
</svg><div class="tip" id="ctip"></div>
<div class="legend">${Object.keys(CLBL).filter(k => counts[k]).map(k => `<span><i style="background:${CFILL[k]}"></i>${CLBL[k]} (${counts[k]})</span>`).join("")}</div></div>
<p class="meta" id="county-live-note"></p>
<p class="meta">Counties take the state's status unless a recorded district differs. Boundaries: US Census Bureau (public domain). District policies with a source link are verified; the rest were carried over from the original map and are being re-checked.</p>
<script>(function(){const tip=document.getElementById("ctip"),box=document.querySelector(".mapbox"),svg=document.querySelector(".countymap");if(!svg)return;
// The state outline is drawn after the counties, so a highlight painted on a county is cut across by
// it. This group is appended after everything, and every highlight goes here.
const NS="http://www.w3.org/2000/svg";
const distLayer=document.createElementNS(NS,"g");distLayer.id="district-layer";distLayer.setAttribute("pointer-events","none");svg.append(distLayer);
const liveLayer=document.createElementNS(NS,"g");liveLayer.id="county-live-layer";liveLayer.setAttribute("pointer-events","none");
const layer=document.createElementNS(NS,"g");layer.id="county-hover-layer";layer.setAttribute("pointer-events","none");
svg.append(liveLayer,layer);
const trace=p=>{layer.textContent="";const r=document.createElementNS(NS,"path");r.setAttribute("d",p.getAttribute("d"));r.setAttribute("fill","rgba(255,255,255,.32)");r.setAttribute("stroke","#0D132D");r.setAttribute("stroke-width","2");r.setAttribute("stroke-linejoin","round");r.setAttribute("vector-effect","non-scaling-stroke");layer.append(r);};
const clear=()=>{layer.textContent="";tip.style.display="none";};
svg.querySelectorAll("path[data-county]").forEach(p=>{const show=e=>{trace(p);tip.innerHTML="<b>"+p.dataset.county+"</b><span class=st>"+p.dataset.status+"</span><br>"+p.dataset.districts;tip.style.display="block";if(e&&e.clientX){const r=box.getBoundingClientRect();tip.style.left=Math.min(e.clientX-r.left+14,r.width-330)+"px";tip.style.top=(e.clientY-r.top+14)+"px";}};
p.addEventListener("mousemove",show);p.addEventListener("focus",show);p.addEventListener("mouseleave",clear);p.addEventListener("blur",clear);
p.addEventListener("click",()=>{const row=document.querySelector('tr[data-key="'+p.dataset.key+'"]');if(row){row.scrollIntoView({behavior:"smooth",block:"center"});row.classList.add("hl");setTimeout(()=>row.classList.remove("hl"),2500);}});});
// District borders are a separate, sizeable file, so they load on their own and only once. The state
// outline and the county fills are already here; this is the layer that shows the unit policy is
// actually set in.
const dbox=document.getElementById("dlines");
let dloaded=false;
const showLines=on=>{distLayer.style.display=on?"":"none";};
const loadLines=async()=>{if(dloaded)return;dloaded=true;
  try{const r=await fetch("/kids/data/districts/districts-"+svg.dataset.state+".json");if(!r.ok)return;const j=await r.json();
    const pth=document.createElementNS(NS,"path");pth.setAttribute("d",j.d);pth.setAttribute("class","district-lines");pth.setAttribute("fill","none");distLayer.append(pth);
    const note=document.querySelector(".dlines");if(note&&j.districts)note.title=j.districts+" school districts, US Census Bureau boundaries";
  }catch(e){}};
if(dbox){
  let want=true;try{want=localStorage.getItem("escp-dlines")!=="off";}catch(e){}
  dbox.checked=want;showLines(want);if(want)loadLines();
  dbox.addEventListener("change",()=>{const on=dbox.checked;try{localStorage.setItem("escp-dlines",on?"on":"off");}catch(e){}if(on)loadLines();showLines(on);});
}
const q=document.getElementById("dsearch");if(q){q.addEventListener("input",()=>{const v=q.value.trim().toLowerCase();document.querySelectorAll("tr[data-key]").forEach(r=>{r.style.display=!v||r.textContent.toLowerCase().includes(v)?"":"none";});svg.querySelectorAll("path[data-county]").forEach(p=>{p.style.opacity=!v||p.dataset.county.toLowerCase().includes(v)||p.dataset.districts.toLowerCase().includes(v)?"1":".25";});});}})();</script>`;
}
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = v => v == null || v === "" ? "" : Number(v).toLocaleString("en-US");
const LABEL = { banned: "Prohibited in public schools", partial: "Legal, but every district has stopped", legal: "Legal in public schools" };
const COLOR = { banned: "#2D6A4F", partial: "#C05621", legal: "#9B2C2C" };
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
<link rel="stylesheet" href="/kids/site.css?v=${ver("site.css")}">\n<script defer src="/kids/news.js?v=${ver("news.js")}"></script>\n<script defer src="/kids/activity.js?v=${ver("activity.js")}"></script>
${extraHead}
</head>
<body>
<header class="top"><div class="wrap">
  <a class="wordmark" href="/kids/">End School <span>Corporal Punishment</span></a>
  <nav><a href="/kids/">Map</a><a href="/kids/resources/">Facts &amp; templates</a><a href="/kids/contribute/">Bring an agent</a><a href="${REPO}" rel="noopener">GitHub</a></nav>
</div></header>
${body.startsWith("<section class=\"hero\">") ? body.slice(0, body.indexOf("</section>") + 10) : ""}
<main class="wrap">
${body.startsWith("<section class=\"hero\">") ? body.slice(body.indexOf("</section>") + 10) : body}
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
@import url('https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Source+Sans+3:wght@400;600;700&display=swap');
:root{--navy-dark:#0D132D;--navy:#151A30;--charcoal:#293340;--gray-pale:#D9DEE8;--gray-light:#E8ECF1;--gray-medium:#8B95A5;--ink:#0D132D;--muted:#5A6577;--bg:#F5F7FA;--card:#FFFFFF;--rule:#D9DEE8;--green:#2D6A4F;--green-dark:#1B4332;--red:#9B2C2C;--red-dark:#742A2A;--partial:#C05621;--gold:#B7791F;--serif:'Merriweather',Georgia,serif;--sans:'Source Sans 3','Source Sans Pro',-apple-system,system-ui,sans-serif;--radius:2px;--shadow:0 2px 8px rgba(0,0,0,.15)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.55 var(--sans)}
a{color:var(--navy-dark)}.wrap{max-width:1200px;margin:0 auto;padding:0 1.25rem}
.top{background:var(--navy-dark);color:#fff;border-bottom:3px solid var(--red)}.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.85rem 1.25rem;flex-wrap:wrap}
.wordmark{font-family:var(--serif);font-weight:700;font-size:1.35rem;text-decoration:none;color:#fff;letter-spacing:.02em}.wordmark span{color:#fff}
.top nav{display:flex;gap:2rem;flex-wrap:wrap}.top nav a{text-decoration:none;color:var(--gray-pale);font-size:.85rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;border-bottom:2px solid transparent;padding-bottom:2px}.top nav a:hover{color:#fff;border-color:#fff}
h1{font-family:var(--serif);font-weight:900;font-size:clamp(1.8rem,3.6vw,2.7rem);line-height:1.12;margin:1.6rem 0 .6rem}h2{font-family:var(--serif);font-size:1.45rem;margin:2.2rem 0 .7rem;color:var(--navy-dark)}h3{font-size:1.05rem;margin:1.3rem 0 .4rem;text-transform:uppercase;letter-spacing:.04em;color:var(--charcoal)}
.hero{background:var(--navy-dark);color:#fff;text-align:center;padding:2.5rem 1.25rem 2rem}.hero h1{color:#fff;margin:0 0 .5rem;font-size:clamp(1.9rem,3.8vw,2.6rem)}.hero .lede{color:var(--gray-pale);margin:0 auto;max-width:70ch}.hero .status{margin-top:.6rem}.hero .crumb{color:var(--gray-pale);font-size:.9rem;margin-bottom:.5rem}.hero .crumb a{color:#fff}
.lede{font-size:1.15rem;color:var(--muted);max-width:66ch;margin:0 0 1.4rem}
.layout{display:grid;grid-template-columns:1fr;gap:1rem}
.mapbox{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);box-shadow:var(--shadow);padding:.75rem;position:relative}
#map svg{width:100%;height:auto;display:block}.countymap{width:100%;height:auto;max-height:68vh;display:block;margin:0 auto}
/* A focusable SVG path gets a default focus ring drawn round its bounding box — a rectangle over
   the map. The county itself is traced instead, so the ring is not wanted. */
.countymap path[data-county]{cursor:pointer}
.countymap path[data-county]:focus{outline:none}
.countymap path[data-county]:focus-visible{outline:none}
.legend{display:flex;flex-wrap:wrap;gap:.6rem 1.4rem;font-size:.92rem;margin:.6rem 0 0;color:var(--charcoal)}.legend i{display:inline-block;width:14px;height:14px;border-radius:2px;margin-right:.45rem;vertical-align:-2px;border:1px solid rgba(0,0,0,.15)}
.tip{position:absolute;pointer-events:none;background:var(--navy-dark);color:#fff;padding:.55rem .75rem;border-radius:var(--radius);font-size:.9rem;line-height:1.35;max-width:320px;box-shadow:var(--shadow);display:none;z-index:5}.tip b{display:block;font-family:var(--serif);font-size:1rem;margin-bottom:.15rem}.tip .st{color:#D9DEE8}
.mapctl{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin:0 0 .5rem}/* text fields only: a checkbox in this bar must not inherit a 220px text-input box */
.mapctl select,.mapctl input[type=search],.mapctl input[type=text]{font:inherit;padding:.4rem .6rem;border:1px solid var(--gray-medium);border-radius:var(--radius);background:#fff;min-width:220px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);padding:1.1rem 1.3rem;box-shadow:var(--shadow)}.card h2{margin-top:0;font-size:1.25rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1rem;margin:1.5rem 0}.stat{background:var(--navy-dark);color:#fff;border-radius:var(--radius);padding:1rem 1.1rem}.stat b{display:block;font-family:var(--serif);font-size:2rem;line-height:1.1}.stat span{color:var(--gray-pale);font-size:.9rem}.stat.legal b{color:#E57373}.stat.banned b{color:#52B788}
.status{display:inline-block;padding:.25rem .7rem;border-radius:var(--radius);color:#fff;font-weight:700;font-size:.85rem;letter-spacing:.03em;text-transform:uppercase}.status.banned{background:var(--green)}.status.partial{background:var(--partial)}.status.legal{background:var(--red)}
table{border-collapse:collapse;width:100%;font-size:.95rem;background:var(--card)}th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--rule);vertical-align:top}th{background:var(--gray-light);font-weight:700}.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:var(--radius);box-shadow:var(--shadow)}
.pill{display:inline-block;padding:.1rem .5rem;border-radius:var(--radius);font-size:.85rem;font-weight:600}.pill.allows{background:#fecaca;color:#991b1b}.pill.bans{background:#bbf7d0;color:#166534}.pill.consent_required{background:#fef3c7;color:#92400e}.pill.unknown{background:#e5e7eb;color:#374151}
.meta{color:var(--muted);font-size:.88rem}.small{font-size:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}
pre{background:#fff;border:1px solid var(--rule);border-radius:var(--radius);padding:1rem;white-space:pre-wrap;font:.85rem/1.5 ui-monospace,Menlo,monospace;overflow-x:auto}.copy{background:var(--navy-dark);color:#fff;border:0;border-radius:var(--radius);padding:.45rem .8rem;cursor:pointer;font:inherit;font-size:.9rem}
.btn{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:.6rem 1rem;border-radius:var(--radius);font-weight:700}
.foot{border-top:1px solid var(--rule);margin-top:3rem;padding-top:1.2rem;padding-bottom:2rem;color:var(--muted);font-size:.88rem}
ul.claims li{margin:.5rem 0}.states-list{columns:3;column-gap:1.5rem;font-size:.95rem}@media(max-width:700px){.states-list{columns:2}}.states-list a{text-decoration:none}
code{background:var(--gray-light);padding:.05rem .3rem;border-radius:var(--radius);font-size:.9em}
.news{list-style:none;padding:0;margin:0}
.news li{display:flex;gap:.7rem;align-items:flex-start;padding:.55rem 0;border-bottom:1px solid var(--rule)}
.news li.meta{display:block}
.news a{text-decoration:none;font-weight:600}
.news .nbody{flex:1;min-width:0}
.news .nbody .meta{display:block}
/* the publisher's mark; their initial shows through when they have no usable icon */
.nthumb{position:relative;flex:0 0 28px;width:28px;height:28px;border-radius:5px;background:var(--gray-light);border:1px solid var(--rule);overflow:hidden;margin-top:.15rem}
.nthumb::before{content:attr(data-letter);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 .82rem/1 var(--sans);color:var(--muted)}
.nthumb img{position:relative;width:100%;height:100%;object-fit:contain;background:#fff;display:block}
tr.hl td{background:#fef3c7}
/* live contribution feed */
.live{background:var(--card);border:1px solid var(--rule);border-radius:var(--radius);padding:1.1rem 1.25rem;margin:1.6rem 0}
.live-head{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap}
.live-head h2{margin:0;font-size:1.3rem}
.live-tag{display:inline-flex;align-items:center;gap:.4rem;font:700 .72rem/1 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--red)}
#live-dot{width:.5rem;height:.5rem;border-radius:50%;background:var(--red);display:inline-block}
#live-dot.beat{animation:livebeat 1.8s ease-out}
@keyframes livebeat{0%{box-shadow:0 0 0 0 rgba(155,44,44,.55)}100%{box-shadow:0 0 0 .7rem rgba(155,44,44,0)}}
.live .stats{margin:1.1rem 0 .2rem}
.live .stat b{font-size:1.75rem}
ul.feed{list-style:none;margin:.6rem 0 0;padding:0;border-top:1px solid var(--rule)}
ul.feed li{display:flex;gap:1rem;align-items:baseline;padding:.6rem 0;border-bottom:1px solid var(--gray-light);font-size:.95rem}
ul.feed .ev-when{flex:0 0 7.5rem;color:var(--muted);font-size:.82rem;font-variant-numeric:tabular-nums}
ul.feed .ev-what{flex:1;min-width:0}
ul.feed .ev-what strong{font-family:var(--serif);font-weight:700}
ul.feed .ev-verified .ev-what strong{color:var(--green-dark)}
ul.feed li.meta{display:block;color:var(--muted)}
path.state-active{stroke:#F6E05E !important;stroke-width:2.4 !important;filter:drop-shadow(0 0 3px rgba(246,224,94,.8))}
#live-map-note{color:var(--muted);font-size:.85rem;margin:.5rem 0 0}
/* counties somebody is working on right now, ringed over the settled record */
.county-live{stroke:#B7791F;stroke-width:2.2;vector-effect:non-scaling-stroke;stroke-linejoin:round}
/* school district borders: the unit policy is actually set in, over the county fills */
.district-lines{stroke:rgba(13,19,45,.42);stroke-width:.6;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.dlines{display:inline-flex;align-items:center;gap:.35rem;font-size:.88rem;color:var(--charcoal);cursor:pointer;white-space:nowrap}
.dlines input{cursor:pointer}
.county-live-verified{stroke:#F6E05E}
#county-live-note{margin:.5rem 0 0}
#county-live-note .county-live-key{display:inline-block;width:.75rem;height:.75rem;border:2px solid #B7791F;border-radius:2px;margin-right:.4rem;vertical-align:-1px}
.ev-place{display:inline-flex;align-items:center;gap:.22rem;color:var(--muted);font-size:.82rem;white-space:nowrap}
.ev-place .pin{flex:none;opacity:.8}
/* social-proof toast */
/* The toast is a notification, not site chrome: a light card, deliberately unlike the navy header,
   and a fixed box so it never resizes as the text behind it changes. */
#live-toast{position:fixed;left:1rem;bottom:1rem;z-index:40;box-sizing:border-box;width:23.5rem;max-width:calc(100vw - 2rem);height:9rem;display:flex;gap:.8rem;align-items:center;background:var(--card);color:var(--ink);border:1px solid var(--rule);border-radius:14px;box-shadow:0 12px 32px rgba(13,19,45,.18);padding:.85rem;opacity:0;transform:translateY(.75rem);pointer-events:none;transition:opacity .35s ease,transform .35s ease}
#live-toast.show{opacity:1;transform:translateY(0);pointer-events:auto}
#live-toast .toast-x{position:absolute;top:.3rem;right:.45rem;background:none;border:0;color:var(--gray-medium);font-size:1.15rem;line-height:1;cursor:pointer;padding:.15rem .3rem}
#live-toast .toast-x:hover{color:var(--ink)}
#live-toast .toast-map{flex:0 0 7rem}
#live-toast .osm{position:relative;width:7rem;height:7rem;border-radius:10px;overflow:hidden;background:#dfe3e8;box-shadow:0 0 0 1px var(--rule)}
#live-toast .osm-world img{position:absolute;inset:0;width:100%;height:100%;display:block}
#live-toast .osm-pan{position:absolute;inset:0;will-change:transform}
#live-toast .osm-pan img{position:absolute;display:block;width:256px;height:256px;max-width:none}
#live-toast .osm-marker{position:absolute;left:50%;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:var(--red);border:2px solid #fff;box-shadow:0 0 0 1px rgba(13,19,45,.45),0 1px 3px rgba(0,0,0,.35)}
#live-toast .osm-credit{position:absolute;right:0;bottom:0;background:rgba(255,255,255,.85);color:var(--charcoal);font:600 8px/1.35 var(--sans);padding:0 3px;border-top-left-radius:4px;text-decoration:none}
#live-toast .osm-credit:hover{background:#fff;text-decoration:underline}
/* The body is the only flexible part, and it is clamped so a long district name cannot grow the box. */
#live-toast .toast-body{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:.35rem;height:100%}
#live-toast .toast-line{margin:0;font-size:.88rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;line-clamp:4;overflow:hidden}
#live-toast .toast-line strong{font-family:var(--serif);font-weight:700;color:var(--navy-dark)}
#live-toast .toast-foot{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:0}
#live-toast .ev-place{color:var(--muted);font-size:.76rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#live-toast .toast-when{color:var(--muted);font-size:.76rem;flex:none}
#live-toast .toast-cta{display:inline-block;color:var(--red-dark);font-weight:700;font-size:.8rem;text-decoration:none;border-bottom:1px solid rgba(155,44,44,.35);padding-bottom:.05rem;align-self:flex-start}
#live-toast .toast-cta:hover{border-bottom-color:var(--red-dark)}
@media(prefers-reduced-motion:reduce){#live-toast{transition:none}}
@media print{#live-toast{display:none}}
@media(max-width:560px){ul.feed li{flex-direction:column;gap:.1rem}ul.feed .ev-when{flex:none}}
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
  extraHead: `<script defer src="/kids/map.js?v=${ver("map.js")}"></script>`,
  body: `<section class="hero"><div class="wrap"><h1>Where a teacher may still legally hit a student</h1>
<p class="lede">In ${legalStates.length} states a public school employee may paddle a child as punishment, and does. In ${partialStates.length} more it is legal but every district has stopped. Hover or tap a state. Every status links to its statute and every number to its source.</p></div></section>
<div class="mapbox"><div class="mapctl"><select id="jump" aria-label="Go to a state"><option value="">Go to a state…</option>${Object.values(states).sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${s.code}">${esc(s.name)}</option>`).join("")}</select><span class="meta">Hover a state for its status and numbers; click to open it. County lines show where district policies differ.</span></div>
<div id="map" aria-live="polite"></div><div class="tip" id="stip"></div><div class="legend" id="legend"></div></div>
<section class="live">
  <div class="live-head"><h2>Being worked on right now</h2><span class="live-tag"><span id="live-dot"></span>Live</span></div>
  <p class="meta">Anyone can point their own AI assistant at this project and it will be given a state, a set of districts, and the rules. Every record below was read out of a primary source by someone else's agent and checked against that source by the server. <a href="/kids/contribute/">Bring yours.</a></p>
  <div class="stats" id="live-stats"></div>
  <ul class="feed" id="live-feed"><li class="meta">Loading recent contributions…</li></ul>
  <p id="live-map-note"></p>
</section>
<h2>Latest news</h2>
<ul class="news" id="news" data-q="&quot;corporal punishment&quot; school"><li class="meta">Loading the latest coverage…</li></ul>
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
  <div class="card"><h2>If you have an AI agent</h2><p>Most of the remaining work is reading district policy manuals and recording what they say, with sources. ${n(districtsIn([...legalStates, ...partialStates].map(x => x.code)))} districts in the ${legalStates.length + partialStates.length} states where it is not prohibited; ${summary.districts_sourced} sourced so far. <a href="/kids/contribute/">Install the skills and take a state.</a></p></div>
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
  const body = `<section class="hero"><div class="wrap"><p class="crumb"><a href="/kids/">Map</a> › ${esc(s.name)}</p>
<h1>${esc(s.name)}</h1>
<p><span class="status ${s.status}">${LABEL[s.status]}${s.year_banned ? ` since ${s.year_banned}` : ""}</span></p>
${s.notes ? `<p class="lede">${esc(s.notes)}</p>` : ""}</div></section>
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
${legal ? `<h2>Counties</h2>
${countyMap(s.code, ds)}
<h2>Districts</h2>
<p class="meta">${ds.length} of ${n(leaCounts[s.code] || 0)} ${esc(s.name)} districts listed; <b>${ds.filter(d => d.source).length} checked against the district's own policy</b>. The rest are marked not checked: the pre-2026 map carried a status for them with no source, and the first ones re-checked in 2026 were wrong more often than not, so those values are shown only as a note and are not used to colour the map. <a href="/kids/contribute/">Help check this state.</a></p>
${ds.length ? `<div class="tablewrap"><table><tr><th>District</th><th>County</th><th>Paddling</th><th>Phones</th><th>AI</th><th>HS start</th><th>Source</th><th>Verified</th></tr>${ds.map(d => `<tr data-key="${esc(norm(d.county))}"><td>${esc(d.name)}</td><td>${esc(d.county || "")}</td><td><span class="pill ${d.status}">${{ allows: "Allows", bans: "Prohibits", consent_required: "Consent required", unknown: "Not checked" }[d.status]}</span>${d.status === "unknown" && d.legacy_status ? `<br><span class="meta">old map said ${esc(d.legacy_status)}</span>` : ""}</td><td class="small">${d.phone_policy ? ({ bell_to_bell_ban: "Bell-to-bell ban", classroom_ban: "Classroom ban", teacher_discretion: "Teacher discretion", allowed: "Allowed", unknown: "" })[d.phone_policy.status] : ""}</td><td class="small">${d.ai_policy ? ({ prohibited: "Prohibited", permitted_with_guidance: "Permitted with guidance", academic_integrity_only: "Cheating rule only", no_policy: "Silent", unknown: "" })[d.ai_policy.status] : ""}</td><td class="small">${d.start_times && d.start_times.high_school && d.start_times.high_school.start ? esc(d.start_times.high_school.start) : ""}</td><td>${d.source ? `<a href="${esc(d.source)}" rel="noopener">${esc(d.policy_code || "policy")}</a>${d.archived_url ? ` <a class="meta" href="${esc(d.archived_url)}" rel="noopener">archive</a>` : ""}${d.document_text_path ? ` <a class="meta" href="${REPO}/blob/main/${esc(d.document_text_path)}" rel="noopener">text</a>` : ""}` : "<span class=\"meta\">none yet</span>"}</td><td class="meta">${d.last_verified || ""}</td></tr>`).join("")}</table></div>` : ""}` : ""}
<h2>In the news</h2>\n<ul class="news" id="news" data-q="${esc(`"corporal punishment" school ${s.name}`)}"><li class="meta">Loading the latest coverage…</li></ul>\n<h2>Do something</h2>
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
  body: `<section class="hero"><div class="wrap"><h1>Facts and templates</h1>
<p class="lede">Every sentence below is a file in the claims registry with its primary source and the date it was last verified. Quote the year with the number. If one is wrong, <a href="${REPO}/issues/new?template=fact-correction.yml">say so</a> and it will be fixed the same day.</p></div></section>
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
  body: `<section class="hero"><div class="wrap"><h1>Bring an agent</h1>
<p class="lede">Most of the remaining work is reading thousands of district policy manuals and recording what they say, with a source and a verbatim quote. That is agent work, and the tools are ready.</p></div></section>
<div class="grid">
<div class="card"><h2>Claude Code</h2><pre>claude plugin marketplace add AnthonyDavidAdams/end-school-corporal-punishment
claude plugin install escp@escp
claude
&gt; /escp:district-policy-scan Mississippi</pre><p class="small">Six skills: district scan, verify claim, bill watch, federal data refresh, decision-maker dossier, share kit. Each ends in a validated pull request.</p></div>
<div class="card"><h2>Any other agent (MCP)</h2><pre>https://escp-mcp-production.up.railway.app/mcp</pre><p class="small">A Model Context Protocol server with the facts, state law, district data, federal counts, the task queue, and tools to submit a district finding or a fact correction. Works from ChatGPT, Cursor, Claude Desktop, or your own code. <a href="${REPO}/blob/main/mcp/README.md">Setup.</a></p></div>
<div class="card"><h2>Ground Crew</h2><p>The server above runs <a href="https://github.com/AnthonyDavidAdams/groundcrew" rel="noopener">Ground Crew</a>, EarthPilot's open protocol for pointing many people's agents at one public problem. Any group can run a crew for its own issue.</p></div>
<div class="card"><h2>The contract</h2><p>Open every source. Quote verbatim. Date everything. Never guess. No student names. <a href="${REPO}/blob/main/AGENTS.md">AGENTS.md</a> is the whole of it, and the validator enforces the schema.</p></div>
<div class="card"><h2>What we record about you</h2><p>The handle or email you give your agent, and the rough location your connection resolves to when you claim work &mdash; city, region, country, looked up once and stored as those three fields.</p><p class="small">Your email is never published: the live feed shows a six-character one-way hash instead. Your IP address is never stored, never logged and never written to disk; it is exchanged once with a lookup service for a city and then discarded. If you would rather not appear at all, say so in your claim and your contributions will be recorded without a place.</p></div>
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
<p class="meta">Claim a scope first with the <a href="${REPO}/issues/new?template=task-claim.yml">task-claim issue</a> so work is not duplicated. ${n(districtsIn([...legalStates, ...partialStates].map(x => x.code)))} districts in the ${legalStates.length + partialStates.length} states where it is not prohibited, counted from the federal district file (NCES Common Core of Data, 2023-24); ${summary.districts_sourced} sourced so far.</p>
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
# CSS and JS are compressed by the host's defaults; JSON and SVG are not, and the district border
# meshes are the largest thing this site serves. Texas goes from 297 KB to 84 KB.
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE application/json image/svg+xml text/plain
</IfModule>
`);
console.log(`built index, ${Object.keys(states).length} state pages, resources, contribute`);
