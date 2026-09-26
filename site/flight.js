// The flight board. Fog of war over the states where a teacher may still hit a child; one ship per
// agent, flying from its pilot's city to the district it claimed; a beam when the finding lands and the
// fog lifts, red or green, for good. The last thirty days replay at speed on load, then the board is
// live from the crew server's fleet feed. Nothing on it is invented: every ship is a contributor and
// every flight is an event the server recorded.
(async () => {
  const host = document.getElementById("flightmap"); if (!host) return;
  const SERVER = "https://escp-mcp-production.up.railway.app";
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n = (x) => Number(x || 0).toLocaleString("en-US");
  const el = (tag, attrs = {}, parent = null) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };

  // ---- projection: the county map's Albers, without a library ----
  const R = Math.PI / 180, p1 = 29.5 * R, p2 = 45.5 * R, pn = (Math.sin(p1) + Math.sin(p2)) / 2, pC = Math.cos(p1) ** 2 + 2 * pn * Math.sin(p1), r0 = Math.sqrt(pC) / pn;
  const raw = (lon, lat) => { const l = (lon + 96) * R, f = lat * R; const r = Math.sqrt(pC - 2 * pn * Math.sin(f)) / pn, t = pn * l; return [r * Math.sin(t), r0 - r * Math.cos(t)]; };
  const c0 = (() => { const l = -0.6 * R, f = 38.7 * R; const r = Math.sqrt(pC - 2 * pn * Math.sin(f)) / pn, t = pn * l; return [r * Math.sin(t), r0 - r * Math.cos(t)]; })();
  const project = (lon, lat) => { const [x, y] = raw(lon, lat); return [487.5 + 1300 * (x - c0[0]), 305 - 1300 * (y - c0[1])]; };

  // ---- data ----
  const [svgText, states, wall, requests] = await Promise.all([
    fetch("/kids/assets/us-map.svg").then((r) => r.text()),
    fetch("/kids/data/states.json").then((r) => r.json()),
    fetch("/kids/data/wall.json").then((r) => r.json()),
    fetch("/kids/data/requests.json").then((r) => r.json()).catch(() => ({ requests: [] })),
  ]);
  host.innerHTML = svgText; const svg = host.querySelector("svg"); svg.removeAttribute("width"); svg.removeAttribute("height");
  const COL = { b: "#43E08A", a: "#FF4D4D", c: "#FFB000", s: "#5E9B7C", u: "#2F6B4E", "-": null, pending: "#FFD966" };
  const LABEL = { b: "board prohibits it", a: "board permits it", c: "permitted with parental consent", s: "documents read, no rule found", u: "on the record, no source", "-": "under fog: nobody has read the rule" };
  const GREEN = "#04170E", LEGAL = "#120507", DIM = "#020604";
  for (const c of svg.querySelectorAll("path.county")) { const s = states[c.dataset.state]; c.setAttribute("fill", !s ? DIM : s.status === "banned" ? GREEN : LEGAL); c.setAttribute("stroke", "rgba(51,255,153,.16)"); c.setAttribute("stroke-width", "0.25"); }
  for (const p of svg.querySelectorAll("path.state, path[data-kind=\"state\"], g.states path")) { p.setAttribute("fill", "none"); p.setAttribute("stroke", "#33FF99"); p.setAttribute("stroke-width", "0.6"); p.setAttribute("opacity", "0.7"); }
  const bricks = new Map(), byKey = new Map();
  const key = (s) => String(s || "").toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/\b(school district|public schools|schools|isd|cisd|county)\b/g, "").replace(/[^a-z0-9]/g, "");
  const gDist = el("g", { id: "fl-districts" }, svg), gBeams = el("g", { id: "fl-beams" }, svg), gShips = el("g", { id: "fl-ships" }, svg), gFx = el("g", { id: "fl-fx" }, svg);
  for (const st of wall.states) for (const b of st.bricks) {
    if (b.x == null) continue;
    b.state = st.code; b.stateName = st.name;
    b.el = el("rect", { x: b.x - 1.2, y: b.y - 1.2, width: 2.4, height: 2.4, rx: 0.4, "data-id": b.i }, gDist);
    paint(b, b.s); bricks.set(b.i, b); byKey.set(`${st.code}|${key(b.n)}`, b);
  }
  function paint(b, s) { b.s = s; const c = COL[s]; if (c) { b.el.setAttribute("fill", c); b.el.setAttribute("stroke", "none"); b.el.setAttribute("opacity", "0.95"); } else { b.el.setAttribute("fill", b.k ? "#1A0609" : "#07130D"); b.el.setAttribute("stroke", b.k > 50 ? "#8A2E3E" : "#1E4A35"); b.el.setAttribute("stroke-width", "0.4"); b.el.setAttribute("opacity", "0.9"); } }
  const resolve = (scope, ncesId) => (ncesId && bricks.get(String(ncesId))) || (() => { const m = String(scope || "").match(/^(.*),\s*([A-Z]{2})$/); return m ? byKey.get(`${m[2]}|${key(m[1])}`) : null; })();

  // ---- camera ----
  const HOME = [0, 0, 975, 610]; let view = [...HOME], target = [...HOME], follow = null;
  svg.setAttribute("viewBox", HOME.join(" "));
  const stateBox = (code) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const c of svg.querySelectorAll(`path.county[data-state="${code}"]`)) { const b = c.getBBox(); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); } if (x0 > 1e8) return null; const pad = 12; return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad]; };
  function camera(mode, arg) {
    follow = null;
    if (mode === "country") target = [...HOME];
    else if (mode === "state") { const b = stateBox(arg); if (b) { const w = Math.max(b[2], b[3] * 975 / 610); target = [b[0] + b[2] / 2 - w / 2, b[1] + b[3] / 2 - (w * 610 / 975) / 2, w, w * 610 / 975]; } }
    else if (mode === "follow") follow = arg;
    document.querySelectorAll("[data-cam]").forEach((x) => x.classList.toggle("on", x.dataset.cam === mode));
    $("flMode").textContent = mode === "follow" ? `FOLLOWING ${arg.callsign.toUpperCase()}` : mode === "state" ? `${(states[arg]?.name || arg).toUpperCase()}` : "COUNTRY";
  }
  function tickCamera() {
    if (follow) { const w = 160; target = [follow.x - w / 2, follow.y - (w * 610 / 975) / 2, w, w * 610 / 975]; }
    for (let i = 0; i < 4; i++) view[i] += (target[i] - view[i]) * 0.08;
    svg.setAttribute("viewBox", view.map((v) => v.toFixed(2)).join(" "));
    const z = 975 / view[2]; gDist.setAttribute("transform", ""); const sc = (1 / Math.sqrt(z)).toFixed(3); for (const s of ships.values()) s.g.setAttribute("transform", `translate(${s.x},${s.y}) scale(${sc})`); 
  }

  // ---- ships ----
  const HULL = { scheduled: "#4FD1FF", claude: "#4FD1FF", cursor: "#FF9BD6", codex: "#A7F3D0", gemini: "#FFD966", mothership: "#FFFFFF", custom: "#C4B5FD" };
  const ships = new Map(); const hangar = [[70, 560], [110, 575], [150, 560], [190, 575], [230, 560], [270, 575], [310, 560], [350, 575]];
  function ship(row) {
    let s = ships.get(row.id);
    if (!s) {
      const home = row.home && row.home.lat != null ? project(row.home.lon, row.home.lat) : hangar[ships.size % hangar.length];
      s = { ...row, x: home[0], y: home[1], hx: home[0], hy: home[1], tx: home[0], ty: home[1], lock: null, beam: 0 };
      s.g = el("g", { class: "fl-ship" }, gShips);
      const c = HULL[row.hull] || HULL.custom;
      s.glow = el("circle", { r: 7, fill: c, opacity: 0.12 }, s.g);
      s.body = el("path", { d: "M0,-7.5 L5.2,6 L0,3 L-5.2,6 Z", fill: c, stroke: "#020604", "stroke-width": 0.5 }, s.g);
      s.ring = el("circle", { r: 10, fill: "none", stroke: c, "stroke-width": 0.6, opacity: 0, "stroke-dasharray": "2 1.5" }, s.g);
      s.label = el("text", { y: 13.5, "text-anchor": "middle", "font-size": 5.6, fill: c, "font-family": "Share Tech Mono, IBM Plex Mono, monospace", "letter-spacing": 0.3 }, s.g); s.label.textContent = row.callsign;
      s.g.addEventListener("click", () => { camera("follow", s); openCockpit(s.lock, s); });
      s.beamEl = el("line", { stroke: c, "stroke-width": 1.1, opacity: 0, "stroke-dasharray": "2 1.2" }, gBeams);
      ships.set(row.id, s);
    } else Object.assign(s, { districts: row.districts, children: row.children, tier: row.tier, display_name: row.display_name, flying: row.flying });
    return s;
  }
  function fly(s, b) { if (!b) return; s.lock = b; s.tx = b.x; s.ty = b.y - 7; s.ring.setAttribute("opacity", 0.9); }
  function land(s) { s.lock = null; s.tx = s.hx; s.ty = s.hy; s.ring.setAttribute("opacity", 0); s.beam = 0; }
  function beam(s, ms = 1400) { if (!s.lock) return; s.beam = performance.now() + ms; }
  function tickShips(now) {
    for (const s of ships.values()) {
      const dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
      if (d > 0.2) { const step = Math.min(d, 2.2 + d * 0.06); s.x += dx / d * step; s.y += dy / d * step; s.body.setAttribute("transform", `rotate(${(Math.atan2(dy, dx) * 180 / Math.PI + 90).toFixed(1)})`); }
      else if (s.lock) { s.x += Math.sin(now / 700 + s.x) * 0.05; s.body.setAttribute("transform", "rotate(180)"); }
      const on = s.lock && s.beam > now && d < 3;
      s.beamEl.setAttribute("opacity", on ? 0.9 : 0); if (on) { s.beamEl.setAttribute("x1", s.x); s.beamEl.setAttribute("y1", s.y + 2); s.beamEl.setAttribute("x2", s.lock.x); s.beamEl.setAttribute("y2", s.lock.y); }
    }
  }
  function flare(b, color) { const c = el("circle", { cx: b.x, cy: b.y, r: 1, fill: "none", stroke: color, "stroke-width": 0.8, opacity: 1 }, gFx); const t0 = performance.now(); const step = () => { const t = (performance.now() - t0) / 900; if (t >= 1) return c.remove(); c.setAttribute("r", 1 + t * 14); c.setAttribute("opacity", 1 - t); requestAnimationFrame(step); }; requestAnimationFrame(step); }

  let mothActiveUntil = 0;
  // ---- HUD, radio, leaderboard ----
  const totals = { placed: wall.totals.placed, bricks: wall.totals.bricks };
  const hud = () => { $("flRecord").textContent = n(totals.placed); $("flDark").textContent = n(totals.bricks - totals.placed); const flying = [...ships.values()].filter((s) => s.lock).length + (Date.now() < mothActiveUntil ? 1 : 0); $("flFlying").textContent = flying; if (!replaying) $("flStatus").textContent = Date.now() < mothActiveUntil ? "LIVE · MOTHERSHIP WORKING" : "LIVE"; };
  function radio(line, cls) { const ul = $("flRadio"); if (!ul) return; const li = document.createElement("li"); if (cls) li.className = cls; li.innerHTML = line; ul.prepend(li); while (ul.children.length > 14) ul.lastChild.remove(); }
  async function leaderboard() {
    let lb; try { lb = await (await fetch(`${SERVER}/leaderboard.json`, { cache: "no-store" })).json(); } catch { return; }
    $("flWeek").textContent = n(lb.totals?.this_week); const ol = $("flLeaders"); if (!ol) return;
    const rows = (lb.all_time || []).slice(0, 12);
    ol.innerHTML = rows.length ? rows.map((r) => { const s = ships.get(r.id); return `<li data-ship="${esc(r.id)}"><span><b style="color:${HULL[s?.hull] || "#C4B5FD"}">${esc(s?.callsign || r.display_name || `pilot ${r.id}`)}</b>${r.display_name ? ` · ${esc(r.display_name)}` : ""} <em>${esc(r.tier || "")}</em></span><span>${n(r.districts)} lifted · ${n(r.children)} kids</span></li>`; }).join("") : `<li class="meta">No pilots yet.</li>`;
    ol.querySelectorAll("li[data-ship]").forEach((li) => li.addEventListener("click", () => { const s = ships.get(li.dataset.ship); if (s) { camera("follow", s); openCockpit(s.lock, s); } }));
  }

  // ---- the cockpit ----
  let stateRows = {}; async function districtRow(b) { if (!stateRows[b.state]) { try { const d = await (await fetch(`/kids/data/records/${b.state}.json`)).json(); stateRows[b.state] = Array.isArray(d) ? d : []; } catch { stateRows[b.state] = []; } } return stateRows[b.state].find((r) => String(r.nces_id) === String(b.i)) || null; }
  const INSTR = ["LOCK", "SENSORS", "TRACTOR", "SCANNER", "JEV", "VERIFIER", "UPLINK", "REVIEW", "COMMS", "MOTHERSHIP"];
  async function openCockpit(b, s) {
    const box = $("flCockpit"); if (!box) return; box.hidden = false;
    if (!b) { box.innerHTML = `<div class="ckhead"><b>${esc(s?.callsign || "")}</b><span>${esc(s?.agent || "")}</span></div><p class="meta">${s?.flying ? "Locked on " + esc(s.flying.scope) : "Parked at " + esc(s?.home?.label || "the hangar") + ". No lease open."}</p>`; return; }
    const row = await districtRow(b); const reqs = (requests.requests || []).filter((r) => String(r.nces_id) === String(b.i));
    const docs = (row?.documents || []).map((d) => `<li><a href="${esc(d.url)}" rel="noopener">${esc(d.kind || "document")}</a> ${d.says ? `· ${esc(d.says)}` : ""}</li>`).join("");
    box.innerHTML = `<div class="ckhead"><b>${esc(b.n)}, ${esc(b.state)}</b><span>${esc(b.c || "")}${b.c ? " County · " : ""}federal id ${esc(b.i)}</span></div>
      <div class="ckgrid"><div class="ckpane"><h3>Dossier</h3>
        <div class="ckrow"><label>Struck 2023-24</label><b>${b.k ? n(b.k) : "none reported"}</b></div>
        <div class="ckrow"><label>Record</label><b style="color:${COL[b.s] || "#8B95A5"}">${esc(LABEL[b.s])}</b></div>
        ${row?.quote ? `<blockquote>“${esc(row.quote)}”</blockquote><div class="ckrow"><label>Source</label><a href="${esc(row.source)}" rel="noopener">${esc(String(row.source).replace(/^https?:\/\//, "").slice(0, 48))}</a></div><div class="ckrow"><label>Read</label><b>${esc(row.last_verified || "")}</b></div>` : ""}
        ${docs ? `<div class="ckrow"><label>Documents read</label></div><ul class="ckdocs">${docs}</ul>` : ""}
        ${reqs.length ? `<div class="ckrow"><label>Records request</label><b>${esc(reqs[0].status)} · sent ${esc(String(reqs[0].sent_at || "").slice(0, 10))}${reqs[0].replies ? ` · ${reqs[0].replies} repl${reqs[0].replies === 1 ? "y" : "ies"}` : ""}</b></div>` : ""}
      </div><div class="ckpane"><h3>Instruments${s ? ` · ${esc(s.callsign)}` : ""}</h3><ul class="ckinstr" id="ckInstr">${INSTR.map((i) => `<li data-i="${i}"><i></i><b>${i}</b><span>dark</span></li>`).join("")}</ul><p class="meta">An instrument stays dark when the agent did that step with its own tools.</p></div></div>
      <div class="ckact">${COL[b.s] ? "" : `<button type="button" class="ckbtn" id="ckHand">Hand this district to my agent</button>`}<button type="button" class="ckbtn alt" id="ckClose">Close</button></div>`;
    $("ckClose").addEventListener("click", () => { box.hidden = true; });
    $("ckHand")?.addEventListener("click", async (e) => { const p = `Connect to the End School Corporal Punishment crew at ${SERVER}/mcp. Call get_started, then claim_task for "${b.n}" in ${b.state} (federal id ${b.i}). Find the district's own student handbook or board policy, quote the sentence on corporal punishment verbatim with its URL, and submit_finding.`; try { await navigator.clipboard.writeText(p); e.target.textContent = "Copied. Hand it over."; } catch { e.target.textContent = p; } });
    if (s?.flying?.lease_id) lightInstruments(s.flying.lease_id, b);
    else if (b.s !== "-") { light("LOCK", `On the record`, true); light("UPLINK", "Approved into the record", true); if (row?.documents?.length) light("TRACTOR", `${row.documents.length} document${row.documents.length > 1 ? "s" : ""} aboard`, true); if (reqs.length) light("COMMS", `Records request ${reqs[0].status}`, true); }
    if (reqs.length) light("COMMS", `Records request ${reqs[0].status}`, true);
  }
  function light(name, text, on) { const li = document.querySelector(`#ckInstr li[data-i="${name}"]`); if (!li) return; li.classList.toggle("on", !!on); li.querySelector("span").textContent = text; }
  async function lightInstruments(leaseId, b) {
    let d; try { d = await (await fetch(`${SERVER}/fleet.json?lease=${encodeURIComponent(leaseId)}&limit=1`, { cache: "no-store" })).json(); } catch { return; }
    for (const r of d.cockpit?.rows || []) { const map = { LOCK: "LOCK", TRACTOR: "TRACTOR", VERIFIER: "VERIFIER", UPLINK: "UPLINK", REVIEW: "REVIEW" }; if (map[r.instrument]) light(map[r.instrument], r.summary, true); }
  }
  gDist.addEventListener("click", (e) => { const id = e.target.getAttribute("data-id"); const b = id && bricks.get(id); if (b) openCockpit(b, [...ships.values()].find((s) => s.lock === b) || null); });

  // ---- comms: Mission Support ----
  let comms = false; try { comms = localStorage.getItem("escp-comms") === "1"; } catch {}
  const commsBtn = $("flComms"); const setComms = (v) => { comms = v; try { localStorage.setItem("escp-comms", v ? "1" : "0"); } catch {} if (commsBtn) commsBtn.textContent = v ? "COMMS OPEN" : "OPEN COMMS"; };
  setComms(comms); commsBtn?.addEventListener("click", () => { setComms(!comms); if (comms) say("Mission Support has you."); });
  let audio = null; const squelch = () => { try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 1100; g.gain.value = 0.03; o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.05); } catch {} };
  const digits = (x) => String(x).split("").join(" ");
  function say(text) { if (!comms || !("speechSynthesis" in window) || document.hidden) return; squelch(); const u = new SpeechSynthesisUtterance(text); u.rate = 0.92; u.pitch = 0.75; u.volume = 0.9; const v = speechSynthesis.getVoices().find((v) => /en[-_]US/i.test(v.lang) && /male|Daniel|Alex|Fred|Google US/i.test(v.name)) || speechSynthesis.getVoices().find((v) => /en/i.test(v.lang)); if (v) u.voice = v; u.onend = squelch; speechSynthesis.speak(u); }

  // ---- events: replay, then live ----
  let lastAt = null, replaying = true;
  function apply(e, fast) {
    const b = resolve(e.scope, e.nces_id); const s = e.contributor ? ships.get(e.contributor) || ship({ id: e.contributor, callsign: e.callsign, hull: "custom", agent: e.agent, home: e.place, districts: 0, children: 0 }) : null;
    const who = e.callsign || "A ship";
    if (e.kind === "claimed") { if (s && b) { fly(s, b); if (!fast) { radio(`<b>${esc(who)}</b> locked on ${esc(b.n)}, ${b.state}`); say(`${who}, Mission Support. You're clear to engage ${b.n}, ${b.stateName}.${b.k ? ` ${digits(b.k)} on the board.` : ""}`); } } }
    else if (e.kind === "fetched") { if (s) beam(s, 900); if (!fast) radio(`<b>${esc(who)}</b> document aboard${e.pages ? `, ${e.pages} pages` : ""}: <span class="meta">${esc(e.url || "")}</span>`); if (!fast && e.pages) say(`Document aboard. ${e.pages} pages.`); }
    else if (e.kind === "submitted" || e.kind === "attempted") { if (s && b) beam(s, 1400); if (b && e.kind === "submitted") { paint(b, "pending"); } if (!fast) radio(`<b>${esc(who)}</b> ${e.kind === "submitted" ? `uplinked ${esc(b?.n || e.subject)}: ${esc(e.status || "")}` : `tried ${esc(b?.n || e.subject)}: no readable source`}`); if (!fast && e.kind === "submitted") say(`Judgment in. ${e.status === "bans" ? "Prohibits" : e.status === "allows" ? "Permits" : e.status || ""}. Uplink.`); }
    else if (e.kind === "verified") { if (b) { const s2 = { bans: "b", allows: "a", consent_required: "c", silent: "s" }[e.status] || "u"; if (!COL[b.s] || b.s === "pending") { totals.placed++; } paint(b, s2); flare(b, COL[s2] || "#fff"); } if (s) { beam(s, 1000); setTimeout(() => { if (s.lock === b) land(s); }, fast ? 200 : 2500); } if (!fast) { radio(`<b>${esc(who)}</b>: ${esc(b?.n || e.subject)} is on the record · <b style="color:${COL[{ bans: "b", allows: "a" }[e.status]] || "#fff"}">${esc(e.status || "")}</b>`, "on"); say(`${who}, ${b?.n || e.subject} is on the record. Good work.`); } }
    else if (e.kind === "returned") { if (b) paint(b, "-"); if (!fast) radio(`<b>${esc(who)}</b>: ${esc(b?.n || e.subject)} returned for another look`); }
    else if (e.kind === "machine") { if (!fast) { radio(`<b>Mothership</b>: ${esc(e.headline || "pass")}`, "on"); say(/complete/i.test(e.headline || "") ? "Mothership pass complete." : "Mothership on station."); } mothership(e.scope, e.at); }
    hud();
  }
  let moth = null; const MOTH_HOME = [560, 470];
  function mothershipInit() { moth = el("g", { class: "fl-moth" }, gShips); el("circle", { r: 13, fill: "#fff", opacity: 0.08 }, moth); el("path", { d: "M-14,0 L-5,-5 L5,-5 L14,0 L5,5 L-5,5 Z", fill: "#fff", opacity: 0.9, stroke: "#020604", "stroke-width": 0.6 }, moth); const t = el("text", { y: 12, "text-anchor": "middle", "font-size": 5.6, fill: "#fff", "font-family": "Share Tech Mono, monospace", "letter-spacing": 0.4 }, moth); t.textContent = "MOTHERSHIP"; moth.setAttribute("transform", `translate(${MOTH_HOME[0]},${MOTH_HOME[1]})`); moth.style.cursor = "pointer"; moth.addEventListener("click", () => { const box = $("flCockpit"); box.hidden = false; box.innerHTML = `<div class="ckhead"><b>Mothership</b><span>EarthPilot's own automated pass</span></div><p>Every night at 02:00 Central the Mothership takes the ${"60"} districts that struck the most children and nobody has read, searches for each one's own policy document, reads it, and has the decision model quote the sentence that settles it. Anything it cannot settle it hands to a person. ${nextPass()}</p><div class="ckact"><button type="button" class="ckbtn alt" id="ckClose">Close</button></div>`; $("ckClose").addEventListener("click", () => { box.hidden = true; }); }); }
  function nextPass() { const now = new Date(); const ct = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" })); const h = ct.getHours() + ct.getMinutes() / 60; const hrs = h < 2 ? 2 - h : 26 - h; return `Next pass in ${Math.floor(hrs)}h ${Math.round((hrs % 1) * 60)}m.`; }
  // The Mothership flies to wherever its pass is: a state's centre when the scope is a state, a district
  // when it is one, and holds there while the pass is recent. Otherwise it parks over the Gulf.
  let mothPos = [...MOTH_HOME], mothTarget = [...MOTH_HOME];
  const stateCenter = (code) => { const b = stateBox(code); return b ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : null; };
  function mothership(scope, at) {
    if (!moth) mothershipInit();
    const b = resolve(scope); const sc = b ? [b.x, b.y - 9] : (scope && states[scope] ? stateCenter(scope) : null);
    mothTarget = sc || [...MOTH_HOME];
    const age = at ? Date.now() - Date.parse(at) : 0; if (age < 40 * 60e3) mothActiveUntil = Math.max(mothActiveUntil, Date.parse(at) + 40 * 60e3);
    moth.dataset.flying = "1";
  }
  function tickMoth() {
    if (!moth) return; if (Date.now() > mothActiveUntil && moth.dataset.flying) { mothTarget = [...MOTH_HOME]; if (Math.hypot(mothTarget[0] - mothPos[0], mothTarget[1] - mothPos[1]) < 1) delete moth.dataset.flying; }
    const dx = mothTarget[0] - mothPos[0], dy = mothTarget[1] - mothPos[1], d = Math.hypot(dx, dy); if (d > 0.3) { const step = Math.min(d, 1.6 + d * 0.04); mothPos[0] += dx / d * step; mothPos[1] += dy / d * step; }
    const z = 975 / view[2], sc = (1 / Math.sqrt(z)).toFixed(3); moth.setAttribute("transform", `translate(${mothPos[0].toFixed(1)},${mothPos[1].toFixed(1)}) scale(${sc})`);
    const on = Date.now() < mothActiveUntil; moth.firstChild.setAttribute("opacity", on ? 0.22 : 0.08);
  }

  async function boot() {
    let d; try { d = await (await fetch(`${SERVER}/fleet.json?limit=3000`, { cache: "no-store" })).json(); } catch { d = null; }
    if (!d || !d.ships) { $("flStatus").textContent = "Fleet feed unavailable; showing the record only."; replaying = false; hud(); leaderboard(); return; }
    for (const row of d.ships) ship(row);
    hud(); leaderboard();
    // Start the replay from the state of the map 30 days ago: every district that changed in the window goes back under fog.
    const ev = d.events || []; for (const e of ev) if (e.kind === "verified") { const b = resolve(e.scope, e.nces_id); if (b && COL[b.s]) { paint(b, "-"); totals.placed--; } }
    hud(); $("flStatus").textContent = `Replaying ${ev.length} events from the last 30 days`; const clock = $("flClock");
    const total = Math.max(1, ev.length), per = Math.max(40, Math.min(220, 20000 / total));
    for (let i = 0; i < ev.length; i++) { const e = ev[i]; if (clock) clock.textContent = new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" }).toUpperCase(); apply(e, i < ev.length - 25); lastAt = e.at; await new Promise((r) => setTimeout(r, per)); }
    replaying = false; $("flStatus").textContent = "LIVE"; if (clock) clock.textContent = "";
    if (!ev.some((e) => Date.now() - Date.parse(e.at) < 3600e3)) radio(`<b>Mission Support</b>: quiet hour. No ship on station. The Mothership's ${nextPass().toLowerCase()} <a href="/kids/connect/" style="color:var(--cyan)">Send a ship</a> and it lands within the hour.`);
    // Ships that hold a lease right now stay on station.
    for (const row of d.ships) { const s = ships.get(row.id); if (row.flying) fly(s, resolve(row.flying.scope)); else if (s.lock) land(s); }
    hud(); poll();
  }
  async function poll() {
    let d; try { d = await (await fetch(`${SERVER}/fleet.json?since=${encodeURIComponent(lastAt || new Date(Date.now() - 3600e3).toISOString())}&limit=200`, { cache: "no-store" })).json(); } catch { return; }
    for (const row of d.ships || []) ship(row);
    for (const e of d.events || []) { if (lastAt && Date.parse(e.at) <= Date.parse(lastAt)) continue; apply(e, false); lastAt = e.at; }
    for (const row of d.ships || []) { const s = ships.get(row.id); if (row.flying && !s.lock) fly(s, resolve(row.flying.scope)); else if (!row.flying && s.lock && s.beam < performance.now()) land(s); }
    const clock = $("flClock"); if (clock) clock.textContent = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    hud();
  }
  setInterval(() => { if (!replaying) poll(); }, 15000); setInterval(leaderboard, 60000);

  // ---- controls ----
  document.querySelectorAll("[data-cam]").forEach((b) => b.addEventListener("click", () => camera(b.dataset.cam, b.dataset.arg)));
  $("flState")?.addEventListener("change", (e) => { if (e.target.value) camera("state", e.target.value); });
  $("flFind")?.addEventListener("keydown", (e) => { if (e.key !== "Enter") return; const v = e.target.value.trim().toLowerCase(); const s = [...ships.values()].find((x) => x.id === v || x.callsign.toLowerCase() === v || (x.display_name || "").toLowerCase() === v); if (s) { camera("follow", s); openCockpit(s.lock, s); e.target.value = ""; } else e.target.value = "no such ship"; });
  svg.querySelectorAll("path.county").forEach((c) => c.addEventListener("dblclick", () => camera("state", c.dataset.state)));
  const sel = $("flState"); if (sel) for (const st of wall.states) { const o = document.createElement("option"); o.value = st.code; o.textContent = `${st.name} · ${n(st.total - st.placed)} under fog`; sel.appendChild(o); }
  mothershipInit();
  // The briefing: shown until dismissed once, and always one click away.
  const briefing = $("flBriefing"); let seen = false; try { seen = localStorage.getItem("escp-briefed") === "1"; } catch {}
  if (briefing) { briefing.hidden = seen; $("briefWatch")?.addEventListener("click", () => { briefing.hidden = true; try { localStorage.setItem("escp-briefed", "1"); } catch {} }); $("flBrief")?.addEventListener("click", () => { briefing.hidden = false; }); }
  (function loop(now) { tickShips(now); tickCamera(); tickMoth(); requestAnimationFrame(loop); })(performance.now());
  setInterval(hud, 5000);
  boot();
})();
