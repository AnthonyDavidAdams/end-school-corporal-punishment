// A victory is a district whose own rule went from permitting corporal punishment to prohibiting it.
// merge-scan logs each one to data/victories.jsonl the moment it happens. This announces it:
//
//   1. everyone who ever contributed a finding hears about it (one short email, with the share kit);
//   2. everyone whose approved findings touched that district, or that state, gets a certificate from
//      EarthPilot -- a page on the site under their handle, and the link by email;
//   3. the live board and the radio get a VICTORY event, which the board treats as the biggest thing
//      that can happen on it.
//
// The certificate says only what the record supports: that the person contributed verified findings
// to the record for that district or state, and that the district's own policy now prohibits the
// practice, with the quote and the source. It does not say the contributor caused the change.
//
//   node tools/victory.mjs [--dry]      announce every unannounced victory, then mark them announced
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { reportOps } from "./lib/ops.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");
const SITE = "https://earthpilot.org/kids";
const SERVER = "https://escp-mcp-production.up.railway.app";
const LOG = join(root, "data/victories.jsonl");
if (!existsSync(LOG)) { console.log("no victories logged"); process.exit(0); }
if (!process.argv.includes("--announce")) { console.log("victory.mjs: announcing is off for now (pass --announce). Logged victories are in data/victories.jsonl; corrections in data/corrections.jsonl."); process.exit(0); }
const rows = readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const fresh = rows.filter((v) => !v.announced);
if (!fresh.length) { console.log(`${rows.length} victories, all announced`); process.exit(0); }

const token = () => { const f = join(process.env.HOME, ".escp-maintainer.env"); const m = existsSync(f) && readFileSync(f, "utf8").match(/ESCP_MAINTAINER_TOKEN=["']?([^"'\n]+)/); return m ? m[1].trim() : null; };
async function call(name, args) {
  const r = await fetch(`${SERVER}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token()}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { ...args, token: token() } } }) });
  const body = await r.text(); const line = body.split("\n").find((l) => l.startsWith("data: ")); const res = line ? JSON.parse(line.slice(6)).result : JSON.parse(body).result;
  const t = res?.content?.[0]?.text ?? ""; return t.startsWith("{") || t.startsWith("[") ? JSON.parse(t) : null;
}
const handle = (human, salt) => createHash("sha256").update(`${salt}:${String(human).trim().toLowerCase()}`).digest("hex").slice(0, 6);
const FIRST = ["Copper", "Quiet", "Long", "Iron", "Blue", "Cedar", "Prairie", "Delta", "Granite", "Amber", "Silver", "North", "Willow", "Cotton", "Timber", "Slate", "River", "Marsh", "Hollow", "Ridge", "Cypress", "Tallow", "Sable", "Pine", "Salt", "Clay", "Flint", "Chalk", "Bayou", "Meadow", "Ember", "Harbor", "Summit", "Canyon", "Juniper", "Sycamore", "Pecan", "Magnolia", "Cinder", "Fallow", "Harvest", "Lantern", "Compass", "Signal", "Quill", "Anvil", "Beacon", "Mercy"];
const SECOND = ["Heron", "Meridian", "Furrow", "Kestrel", "Osprey", "Plover", "Sparrow", "Wren", "Kite", "Falcon", "Harrier", "Crane", "Egret", "Swift", "Tern", "Lark", "Finch", "Thrush", "Warbler", "Ibis", "Pelican", "Curlew", "Bittern", "Grouse", "Quail", "Merlin", "Condor", "Raven", "Rook", "Jay", "Magpie", "Oriole", "Tanager", "Vireo", "Sandpiper", "Killdeer", "Nighthawk", "Skylark", "Bunting", "Junco", "Siskin", "Towhee", "Cardinal", "Mockingbird", "Kingfisher", "Loon", "Gannet", "Albatross"];
const callsign = (id) => { const h = createHash("sha256").update(`callsign:${id}`).digest(); return `${FIRST[h[0] % FIRST.length]} ${SECOND[h[1] % SECOND.length]}`; };

// Everyone who contributed, and what each one touched. Approved findings only; the crew name is the handle salt.
const crewName = JSON.parse(readFileSync(join(root, "crew/crew.json"), "utf8")).name;
// export_findings returns at most 500 at a time; page by `since` until a page comes back short.
const exported = [];
for (let since = "2000-01-01T00:00:00.000Z", guard = 0; guard < 40; guard++) {
  const page = (await call("export_findings", { status: "approved", task: "district-policy-scan", since }))?.findings ?? [];
  const seen = new Set(exported.map((f) => f.id)); const fresh = page.filter((f) => !seen.has(f.id)); exported.push(...fresh);
  if (page.length < 500 || !fresh.length) break;
  since = page.map((f) => f.reviewed_at || f.submitted_at).filter(Boolean).sort().pop() || since;
}
const people = new Map();
for (const f of exported) {
  if (!f.human) continue;
  const p = people.get(f.human) ?? { human: f.human, id: handle(f.human, crewName), districts: new Set(), states: new Set(), agents: new Set() };
  const r = f.record ?? {}; if (r.nces_id) p.districts.add(String(r.nces_id)); if (r.state) p.states.add(r.state); if (f.agent) p.agents.add(f.agent);
  people.set(f.human, p);
}
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${d}, ${y}`; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function certificateHtml({ v, p, level, badges }) {
  const name = badges?.[p.id]?.display_name || callsign(p.id);
  const what = level === "district" ? `verified findings to the public record for ${esc(v.name)}, ${esc(v.state)}` : `verified findings to the public record for ${esc(v.state)}, the state in which ${esc(v.name)} sits`;
  const url = `${SITE}/certificates/${p.id}/${slug(v.name)}-${v.state.toLowerCase()}/`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificate of Contribution: ${esc(name)} and ${esc(v.name)}, ${esc(v.state)}</title>
<meta name="description" content="EarthPilot certifies that ${esc(name)} contributed ${what}, whose policy now prohibits corporal punishment."><meta property="og:title" content="Certificate of Contribution: ${esc(name)}"><meta property="og:description" content="${esc(v.name)}, ${esc(v.state)} now prohibits corporal punishment. ${esc(name)} contributed to the record that shows it."><meta property="og:image" content="${SITE}/assets/og-image.png"><meta property="og:url" content="${url}"><meta property="og:type" content="website"><meta property="og:site_name" content="End School Corporal Punishment"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Certificate of Contribution: ${esc(name)}"><meta name="twitter:description" content="${esc(v.name)}, ${esc(v.state)} now prohibits corporal punishment."><meta name="twitter:image" content="${SITE}/assets/og-image.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700;900&family=Source+Sans+3:wght@400;600&display=swap">
<style>@page{size:letter landscape;margin:0}body{margin:0;background:#F5F7FA;font-family:'Source Sans 3',system-ui,sans-serif;color:#0D132D}.sheet{max-width:1000px;margin:24px auto;background:#fff;border:14px double #B7791F;padding:48px 56px;position:relative}.sheet::after{content:"";position:absolute;inset:6px;border:1px solid #B7791F;pointer-events:none}.kicker{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#B7791F;text-align:center}h1{font-family:Merriweather,Georgia,serif;font-weight:900;font-size:34px;text-align:center;margin:.3rem 0 1.2rem}.name{font-family:Merriweather,Georgia,serif;font-size:30px;text-align:center;margin:.4rem 0}.body{font-size:17px;line-height:1.55;text-align:center;max-width:46rem;margin:0 auto}blockquote{font-family:Merriweather,Georgia,serif;font-size:15px;margin:1.2rem auto;max-width:44rem;padding:.6rem 1rem;border-left:3px solid #B7791F;background:#F5F7FA;text-align:left}.row{display:flex;justify-content:space-between;align-items:flex-end;margin-top:2rem;font-size:13px;color:#5A6577}.sig{text-align:center}.sig b{display:block;font-family:Merriweather,Georgia,serif;color:#0D132D;font-size:16px}.verify{font-size:11px;color:#5A6577;text-align:center;margin-top:1.2rem}a{color:#1B2A41}@media print{body{background:#fff}.sheet{margin:0;max-width:none;min-height:100vh;box-sizing:border-box}}</style></head>
<body><div class="sheet"><div class="kicker">EarthPilot · Safe Schools Project</div><h1>Certificate of Contribution</h1>
<p class="body">This certifies that</p><p class="name">${esc(name)}</p>
<p class="body">contributed ${what}. On the strength of the record, we can say this in the district's own words:</p>
<blockquote>“${esc(v.quote)}”</blockquote>
<p class="body">${esc(v.name)}, ${esc(v.state)}, whose policy was recorded as permitting corporal punishment, now prohibits it.${v.students_struck ? ` In 2023-24 it reported ${Number(v.students_struck).toLocaleString("en-US")} students struck.` : ""} The record changed on ${fmt(v.at)}.</p>
<div class="row"><div>Findings approved under this handle: ${p.districts.size} district${p.districts.size === 1 ? "" : "s"}${p.agents.size ? ` · flown by ${esc([...p.agents][0])}` : ""}<br>Contributor handle ${esc(p.id)}</div><div class="sig"><b>Anthony Adams</b>EarthPilot, for the Safe Schools Project<br>${fmt(new Date().toISOString())}</div></div>
<p class="verify">Verify: the district's policy is at <a href="${esc(v.source)}">${esc(v.source.replace(/^https?:\/\//, "").slice(0, 70))}</a> and its entry on the record at <a href="${SITE}/state/${esc(v.state)}/">${SITE.replace(/^https?:\/\//, "")}/state/${esc(v.state)}/</a>. EarthPilot is a project, not an accrediting body; this certificate records a contribution to a public record and nothing more.</p>
</div></body></html>`;
}

function sendMail(to, subject, body) {
  if (DRY) { console.log(`  [dry] mail -> ${to}: ${subject}`); return; }
  execFileSync("python3", ["-c", `
import sys,json; sys.path.insert(0,'tools/outreach'); import run
from email.message import EmailMessage
m=EmailMessage(); m['From']=run.FROM; m['To']=sys.argv[1]; m['Subject']=sys.argv[2]; m.set_content(sys.argv[3]); run.smtp_send(m)`, to, subject, body], { cwd: root, stdio: "ignore" });
}

const badges = (await fetch(`${SERVER}/crew.json`).then((r) => r.json()).catch(() => ({ members: [] }))).members?.reduce((a, m) => ({ ...a, [m.id]: m }), {}) ?? {};
let certs = 0, mails = 0;
for (const v of fresh) {
  const scope = `${v.name}, ${v.state}`;
  console.log(`VICTORY ${scope}: ${v.from} -> bans`);
  // 1. the board and the radio
  if (!DRY) await reportOps({ pass: `victory-${new Date().toISOString().slice(0, 10)}`, summary: `VICTORY: ${v.name}, ${v.state} now prohibits corporal punishment, in its own policy's words`, units: 1, produced: 1, scope });
  // 2. certificates for everyone whose approved findings touched the district or the state
  for (const p of people.values()) {
    const level = v.nces_id && p.districts.has(String(v.nces_id)) ? "district" : p.states.has(v.state) ? "state" : null;
    if (!level) continue;
    const dir = join(root, "site/certificates", p.id, `${slug(v.name)}-${v.state.toLowerCase()}`);
    if (!DRY) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "index.html"), certificateHtml({ v, p, level, badges })); }
    certs++;
    const url = `${SITE}/certificates/${p.id}/${slug(v.name)}-${v.state.toLowerCase()}/`;
    console.log(`  certificate (${level}) for ${badges[p.id]?.display_name || callsign(p.id)} -> ${url}`);
    if (isEmail(p.human)) { sendMail(p.human, `${v.name}, ${v.state} now prohibits corporal punishment — your certificate`, `${v.name}, ${v.state} changed its rule. Its own policy now says:\n\n"${v.quote}"\n\nYou contributed verified findings to the record for ${level === "district" ? "that district" : "that state"}, so there is a certificate from EarthPilot with your name on it:\n\n${url}\n\nIt prints to a letter sheet. Thank you.\n\nAnthony\nSafe Schools Project · earthpilot.org/kids\n`); mails++; }
  }
  // 3. everyone else hears about it once
  const touched = new Set([...people.values()].filter((p) => (v.nces_id && p.districts.has(String(v.nces_id))) || p.states.has(v.state)).map((p) => p.human));
  for (const p of people.values()) {
    if (touched.has(p.human) || !isEmail(p.human)) continue;
    sendMail(p.human, `A district stopped: ${v.name}, ${v.state}`, `${v.name}, ${v.state} now prohibits corporal punishment. Its own policy:\n\n"${v.quote}"\n\nThe record moved because people pointed their agents at it. If you want to tell someone, the share kit has a post and an image for every audience: ${SITE}/share/\n\nAnthony\nSafe Schools Project · earthpilot.org/kids\n`); mails++;
  }
  v.announced = DRY ? false : new Date().toISOString();
}
if (!DRY) writeFileSync(LOG, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`${fresh.length} victor${fresh.length === 1 ? "y" : "ies"}: ${certs} certificates, ${mails} emails${DRY ? " (dry run, nothing written or sent)" : ""}`);
