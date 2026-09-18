// The live feed on the front page: what contributors' agents have done lately.
//
// Everything here comes from the Ground Crew server's public /activity.json, which publishes the work
// and not the worker: contributors appear as a six-character one-way hash, and no email, address or
// location is collected or shown. So the feed says what was read and where, which is the part a
// visitor should find persuasive anyway.

const SERVER = "https://escp-mcp-production.up.railway.app";
const POLL_MS = 45000;

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const stateName = (code) => STATE_NAMES[code] ?? code;

// The agent string is whatever the contributor set. Show the model, not the plumbing.
// The agent string is whatever the contributor set, e.g. "claude-fable-5-1 via Claude.ai". Name the
// model, and put a person in front of it.
function agentLabel(agent) {
  const s = String(agent ?? "");
  let model = null;
  if (/fable/i.test(s)) model = "Claude Fable";
  else if (/opus/i.test(s)) model = "Claude Opus";
  else if (/sonnet/i.test(s)) model = "Claude Sonnet";
  else if (/haiku/i.test(s)) model = "Claude Haiku";
  else if (/claude/i.test(s)) model = "Claude";
  else if (/gpt|openai/i.test(s)) model = "GPT";
  else if (/gemini/i.test(s)) model = "Gemini";
  return model ? `Someone's ${model} agent` : "Someone's agent";
}

// A small pin, drawn rather than an emoji, so it inherits the type colour and stays crisp.
const PIN = '<svg class="pin" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 2c-3.9 0-7 3.1-7 7 0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';

// ---- the little map in the toast ----
// A square of OpenStreetMap centred on the contributor's town, built from four tiles laid out in a
// grid and shifted so the point sits in the middle, then clipped. Four <img> and a transform: no
// image processing, and no canvas.
//
// The tiles come from the crew's own server, not from a tile provider. A browser fetching them
// directly would tell that provider the address of every person who reads this page, on every view.
const MAP_ZOOM = 10;      // a town and the country around it
const TILE = 256;
const MAP_PX = 112;       // the square, in CSS pixels

// Web Mercator, matching the server.
function tileFor(lat, lon, z) {
  const n = 2 ** z;
  const latR = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  return { x, y };
}

// No location resolved: show the world. Zoom 0 is a single tile holding the whole planet, so this is
// the same machinery and the same cache, and it says something true rather than showing a grey box.
function worldSquare() {
  return `<div class="osm osm-world" role="img" aria-label="Map of the world">
    <img src="${SERVER}/tiles/0/0/0.png" alt="" loading="lazy" decoding="async" width="256" height="256">
    <a class="osm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OSM</a>
  </div>`;
}

function mapSquare(place) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return worldSquare();
  const { x, y } = tileFor(place.lat, place.lon, MAP_ZOOM);
  const tx = Math.floor(x), ty = Math.floor(y);
  const n = 2 ** MAP_ZOOM;
  // Where the point sits inside its own tile, in pixels.
  const px = (x - tx) * TILE, py = (y - ty) * TILE;
  // Lay a 2x2 starting at the tile up-and-left, then shift so the point lands at the centre.
  const originX = tx - 1, originY = ty - 1;
  const left = -(TILE + px - MAP_PX / 2);
  const top = -(TILE + py - MAP_PX / 2);
  const imgs = [];
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      const gx = originX + dx, gy = originY + dy;
      if (gy < 0 || gy >= n) continue;
      const wrapped = ((gx % n) + n) % n;
      imgs.push(`<img src="${SERVER}/tiles/${MAP_ZOOM}/${wrapped}/${gy}.png" alt="" loading="lazy" decoding="async" width="${TILE}" height="${TILE}" style="left:${dx * TILE}px;top:${dy * TILE}px">`);
    }
  }
  return `<div class="osm" role="img" aria-label="Map of ${esc(place.label || "the contributor's area")}">
    <div class="osm-pan" style="transform:translate(${left}px,${top}px)">${imgs.join("")}</div>
    <span class="osm-marker"></span>
    <a class="osm-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OSM</a>
  </div>`;
}

const placeBit = (e) => (e.place && e.place.label ? `<span class="ev-place">${PIN}${esc(e.place.label)}</span>` : "");

// Someone's agent, not an agent. The person is the story: a stranger decided this mattered enough to
// point their own assistant at it and spend their own tokens. "An agent read a policy" loses that.
function line(e) {
  const who = agentLabel(e.agent);
  const where = e.scope ? ` in ${esc(stateName(e.scope))}` : "";
  switch (e.kind) {
    case "verified": return `${who} had <strong>${esc(e.subject || "a district")}</strong> reviewed and added to the public record`;
    case "submitted": return `${who} read <strong>${esc(e.subject || "a district policy")}</strong>${where} and quoted it from the primary source`;
    case "claimed": return `${who} took on <strong>${esc(e.scope ? stateName(e.scope) : "a new state")}</strong>`;
    case "attempted": return `${who} looked at <strong>${esc(e.subject || "a district")}</strong>${where} — no readable primary source yet`;
    case "reported": return `${who} reported a problem with the tools`;
    case "suggested": return `${who} proposed an improvement to the tools`;
    default: return `${who} contributed${where}`;
  }
}

function renderStats(el, t) {
  const cells = [
    [t.records, "district policies in the public record, each with a source and a verbatim quote"],
    [t.pending_review, "submitted and waiting on a human reviewer"],
    [t.documents_read, "policy documents read and cached by the server"],
    [t.contributors, t.contributors === 1 ? "contributor has brought an agent so far" : "contributors have brought agents so far"],
  ];
  el.innerHTML = cells.map(([n, label]) => `<div class="stat"><b>${Number(n ?? 0).toLocaleString()}</b><span>${label}</span></div>`).join("");
}

function renderFeed(el, events) {
  if (!events.length) { el.innerHTML = `<li class="meta">No contributions recorded yet. <a href="/kids/contribute/">Be the first.</a></li>`; return; }
  el.innerHTML = events.slice(0, 8).map((e) => `<li class="ev ev-${esc(e.kind)}"><span class="ev-when">${esc(e.ago || "")}</span><span class="ev-what">${line(e)} ${placeBit(e)}</span></li>`).join("");
}

// States touched in the last day get a ring on the map, so the picture is of work in progress rather
// than a finished dataset.
function markMap(events) {
  const svg = document.querySelector("#map svg");
  if (!svg) return false;
  // #state-borders is painted after the state shapes, so a ring drawn on the shape itself gets cut
  // across by it. map.js appends a #live-layer after everything for exactly this; draw into that.
  const layer = svg.querySelector("#live-layer");
  if (!layer) return false;
  const dayAgo = Date.now() - 86400000;
  const hot = new Set(events.filter((e) => Date.parse(e.at) > dayAgo).map((e) => e.scope).filter(Boolean));
  layer.textContent = "";
  for (const p of svg.querySelectorAll("path.state")) {
    if (!hot.has(p.dataset.state)) continue;
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ring.setAttribute("d", p.getAttribute("d"));
    ring.setAttribute("class", "state-active");
    ring.setAttribute("fill", "none");
    layer.append(ring);
  }
  const note = document.getElementById("live-map-note");
  if (note) {
    const names = [...hot].map(stateName);
    note.textContent = names.length
      ? `Outlined on the map: ${names.join(", ")} — worked on in the last 24 hours.`
      : "";
  }
  return true;
}

// The toast: one recent contribution at a time in the corner, the way a shop shows that somebody
// else just bought something. It is the same data as the panel above; the panel is for reading and
// this is for the room feeling occupied. Dismissing it is remembered, and it never covers the page.
// It cycles for as long as the page is open. It used to stop after six, which meant the whole
// sequence was over inside two minutes and anyone who scrolled down after that saw nothing at all —
// which is exactly what a returning visitor does. Dismissing it is still permanent.
const TOAST_SHOW_MS = 8000, TOAST_GAP_MS = 11000, TOAST_FIRST_MS = 2500;
let toastCursor = 0, toastEvents = [], toastTimer = null, toastOff = false;

try { toastOff = localStorage.getItem("escp-live-toast") === "off"; } catch { toastOff = false; }

function toastEl() {
  let el = document.getElementById("live-toast");
  if (el) return el;
  el = document.createElement("div");
  el.id = "live-toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);
  return el;
}

function hideToast() {
  const el = document.getElementById("live-toast");
  if (el) el.classList.remove("show");
}

function showToast(e) {
  const el = toastEl();
  // The map column is always rendered, with a placeholder when there is no location, so the box is
  // the same shape every time it appears.
  const map = mapSquare(e.place);
  el.innerHTML = `
    <button class="toast-x" aria-label="Stop showing these">&times;</button>
    <div class="toast-map">${map}</div>
    <div class="toast-body">
      <p class="toast-line">${line(e)}</p>
      <p class="toast-foot">${placeBit(e) || '<span class="ev-place">Somewhere on Earth</span>'}<span class="toast-when">${esc(e.ago || "")}</span></p>
      <a class="toast-cta" href="/kids/contribute/">Volunteer compute &rarr;</a>
    </div>`;
  el.querySelector(".toast-x").addEventListener("click", () => {
    toastOff = true;
    try { localStorage.setItem("escp-live-toast", "off"); } catch { /* private window: off for this visit only */ }
    hideToast();
    clearTimeout(toastTimer);
  });
  el.classList.add("show");
  toastTimer = setTimeout(() => {
    hideToast();
    toastTimer = setTimeout(nextToast, TOAST_GAP_MS);
  }, TOAST_SHOW_MS);
}

function nextToast() {
  if (toastOff || !toastEvents.length) return;
  if (toastCursor >= toastEvents.length) toastCursor = 0;   // round again
  showToast(toastEvents[toastCursor++]);
}

function primeToasts(events) {
  if (toastOff) return;
  // Only the substantive events; "proposed an improvement to the tools" is not social proof.
  const good = events.filter((e) => e.kind === "submitted" || e.kind === "verified" || e.kind === "claimed");
  if (!good.length) return;
  toastEvents = good.slice(0, 24);
  if (!toastTimer) toastTimer = setTimeout(nextToast, TOAST_FIRST_MS);
}

// The county map on a state page is built from the merged dataset, so it only moves when findings are
// approved and the site is rebuilt. This rings the counties somebody's agent has touched since then,
// so a visitor can see the work in progress rather than only the settled record. The district-to-county
// mapping is already on the page, in the table under the map.
function markCountyMap(events) {
  const svg = document.querySelector(".countymap[data-state]");
  if (!svg) return false;
  const layer = svg.querySelector("#county-live-layer");
  if (!layer) return false;
  const code = svg.dataset.state;

  const countyOf = new Map();
  for (const row of document.querySelectorAll("tr[data-key]")) {
    const name = row.cells[0] && row.cells[0].textContent.trim().toLowerCase();
    if (name) countyOf.set(name, row.dataset.key);
  }

  const weekAgo = Date.now() - 7 * 86400000;
  const hot = new Map();      // county key -> most recent event
  for (const e of events) {
    if (e.scope !== code || !e.subject || Date.parse(e.at) < weekAgo) continue;
    const key = countyOf.get(e.subject.trim().toLowerCase());
    if (key && !hot.has(key)) hot.set(key, e);
  }

  layer.textContent = "";
  for (const [key, e] of hot) {
    const p = svg.querySelector(`path[data-key="${CSS.escape(key)}"]`);
    if (!p) continue;
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "path");
    ring.setAttribute("d", p.getAttribute("d"));
    ring.setAttribute("class", `county-live county-live-${esc(e.kind)}`);
    ring.setAttribute("fill", "none");
    layer.append(ring);
  }

  const note = document.getElementById("county-live-note");
  if (note) {
    const n = hot.size;
    note.innerHTML = n
      ? `<span class="county-live-key"></span>${n} ${n === 1 ? "county has" : "counties have"} been worked on in the last week by contributors' agents. <a href="/kids/contribute/">Bring yours.</a>`
      : "";
  }
  return true;
}

async function tick() {
  const stats = document.getElementById("live-stats");
  const feed = document.getElementById("live-feed");
  let data;
  try {
    const res = await fetch(`${SERVER}/activity.json?limit=60`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    if (feed && !feed.dataset.loaded) feed.innerHTML = `<li class="meta">The live feed is unreachable right now. The <a href="/kids/contribute/">work itself</a> is unaffected.</li>`;
    return;
  }
  const events = data.events || [];
  // The panel is only on the front page. The toast runs wherever this script is loaded.
  if (stats) renderStats(stats, data.totals || {});
  if (feed) {
    feed.dataset.loaded = "1";
    renderFeed(feed, events);
    const live = document.getElementById("live-dot");
    if (live) { live.classList.remove("beat"); void live.offsetWidth; live.classList.add("beat"); }
  }
  // map.js builds the SVG and its layers after its own fetches, so retry a few times rather than once.
  if (document.getElementById("map") && !markMap(events)) {
    let tries = 0;
    const retry = setInterval(() => { if (markMap(events) || ++tries > 12) clearInterval(retry); }, 600);
  }
  markCountyMap(events);
  primeToasts(events);
}

// The panel only exists on the front page; the toast is welcome anywhere, so it runs on any page
// that has not opted out. Respect a reduced-motion preference by skipping the toast entirely.
if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) toastOff = true;

tick();
// Keep polling anywhere something on the page reflects live work: the panel on the front page, the
// county rings on a state page. Elsewhere one fetch is enough to fill the toast.
if (document.getElementById("live-feed") || document.querySelector(".countymap[data-state]")) setInterval(tick, POLL_MS);
