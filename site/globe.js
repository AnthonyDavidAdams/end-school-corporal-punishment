// The swarm, on a globe. Agents connect from anywhere; the work is all in one country. That gap is
// the thing worth showing in a room, so the picture is a rotating Earth with an arc from each
// contributor to the state their agent is reading.
//
// No mapping library. An orthographic projection is a dozen lines of trigonometry and a great circle
// is a spherical interpolation, and keeping it hand-rolled means the page has no runtime dependency
// and cannot break because a CDN moved.
(async () => {
  const host = document.getElementById("globe");
  if (!host) return;
  const SERVER = "https://escp-mcp-production.up.railway.app";
  const NS = "http://www.w3.org/2000/svg";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const R = 300, CX = 340, CY = 340;
  const rad = d => d * Math.PI / 180;

  const [world, stateCentres] = await Promise.all([
    fetch("/kids/data/world.json").then(r => r.json()),
    fetch("/kids/data/state-latlon.json").then(r => r.json()).catch(() => ({})),
  ]);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${CX * 2} ${CY * 2}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "A globe showing where agents are connecting from and where in the United States they are working");
  host.append(svg);

  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = `
    <radialGradient id="ocean" cx="35%" cy="30%">
      <stop offset="0%" stop-color="#16224A"/><stop offset="70%" stop-color="#0E1734"/><stop offset="100%" stop-color="#080D1F"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%">
      <stop offset="70%" stop-color="#7CE0A8" stop-opacity="0"/><stop offset="100%" stop-color="#7CE0A8" stop-opacity=".22"/>
    </radialGradient>`;
  svg.append(defs);

  const atmos = document.createElementNS(NS, "circle");
  atmos.setAttribute("cx", CX); atmos.setAttribute("cy", CY); atmos.setAttribute("r", R * 1.06);
  atmos.setAttribute("fill", "url(#glow)");
  const ocean = document.createElementNS(NS, "circle");
  ocean.setAttribute("cx", CX); ocean.setAttribute("cy", CY); ocean.setAttribute("r", R);
  ocean.setAttribute("fill", "url(#ocean)");
  const land = document.createElementNS(NS, "g");
  const grid = document.createElementNS(NS, "g");
  const arcs = document.createElementNS(NS, "g");
  svg.append(atmos, ocean, grid, land, arcs);

  // Orthographic: the view from infinitely far away. A point is drawn only if it is on the near side,
  // which is what cos(c) > 0 tests.
  let rot = -62;                     // longitude at the centre of the view
  const TILT = rad(22);              // a fixed northward tilt, so the US sits comfortably in view
  const project = (lon, lat) => {
    const l = rad(lon - rot), p = rad(lat);
    const cosc = Math.sin(TILT) * Math.sin(p) + Math.cos(TILT) * Math.cos(p) * Math.cos(l);
    if (cosc <= 0) return null;
    return [CX + R * Math.cos(p) * Math.sin(l), CY - R * (Math.cos(TILT) * Math.sin(p) - Math.sin(TILT) * Math.cos(p) * Math.cos(l))];
  };

  // A great circle, sampled. Slerp on the unit sphere, then project each sample; a segment that goes
  // round the back simply stops, which is correct rather than something to hide.
  const toXYZ = (lon, lat) => { const l = rad(lon), p = rad(lat); return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
  const toLL = ([x, y, z]) => [Math.atan2(y, x) * 180 / Math.PI, Math.asin(z) * 180 / Math.PI];
  function greatCircle(a, b, n = 48) {
    const A = toXYZ(...a), B = toXYZ(...b);
    const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
    const w = Math.acos(dot);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s = w < 1e-6 ? [1 - t, t] : [Math.sin((1 - t) * w) / Math.sin(w), Math.sin(t * w) / Math.sin(w)];
      out.push(toLL([0, 1, 2].map(k => s[0] * A[k] + s[1] * B[k])));
    }
    return out;
  }
  const pathOf = (coords) => {
    let d = "", pen = false;
    for (const [lon, lat] of coords) {
      const p = project(lon, lat);
      if (!p) { pen = false; continue; }
      d += (pen ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
      pen = true;
    }
    return d;
  };

  for (let lat = -60; lat <= 60; lat += 30) {
    const g = document.createElementNS(NS, "path");
    g.dataset.lat = lat; g.setAttribute("fill", "none"); g.setAttribute("stroke", "#25315F"); g.setAttribute("stroke-width", ".7");
    grid.append(g);
  }

  let live = [];
  function draw() {
    land.textContent = "";
    for (const ring of world.rings) {
      const d = pathOf(ring);
      if (!d) continue;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d + "Z"); p.setAttribute("fill", "#1E2A52"); p.setAttribute("stroke", "#33406F"); p.setAttribute("stroke-width", ".6");
      land.append(p);
    }
    for (const g of grid.children) {
      const lat = Number(g.dataset.lat);
      g.setAttribute("d", pathOf(Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat])));
    }
    arcs.textContent = "";
    for (const l of live) {
      const from = l.place && Number.isFinite(l.place.lat) ? [l.place.lon, l.place.lat] : null;
      const sc = stateCentres[String(l.scope ?? "").slice(0, 2).toUpperCase()];
      const to = sc ? [sc.lon, sc.lat] : null;
      if (from && to) {
        const d = pathOf(greatCircle(from, to));
        if (d) {
          const a = document.createElementNS(NS, "path");
          a.setAttribute("d", d); a.setAttribute("fill", "none"); a.setAttribute("stroke", "#7CE0A8");
          a.setAttribute("stroke-width", "2"); a.setAttribute("opacity", ".75"); a.setAttribute("stroke-linecap", "round");
          a.innerHTML = `<animate attributeName="stroke-dasharray" values="0 400;400 0" dur="2.2s" repeatCount="indefinite"/>`;
          arcs.append(a);
        }
      }
      for (const [ll, fill, r] of [[from, "#7CE0A8", 6], [to, "#C9A227", 5]]) {
        if (!ll) continue;
        const p = project(ll[0], ll[1]);
        if (!p) continue;
        const halo = document.createElementNS(NS, "circle");
        halo.setAttribute("cx", p[0]); halo.setAttribute("cy", p[1]); halo.setAttribute("r", r); halo.setAttribute("fill", fill); halo.setAttribute("opacity", ".4");
        halo.innerHTML = `<animate attributeName="r" values="${r};${r * 2.6};${r}" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values=".5;0;.5" dur="2.6s" repeatCount="indefinite"/>`;
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", p[0]); dot.setAttribute("cy", p[1]); dot.setAttribute("r", 3.4); dot.setAttribute("fill", fill);
        arcs.append(halo, dot);
      }
    }
  }

  // A slow sway rather than a spin. Contributors can be anywhere, but the work is all in one country,
  // and a full rotation spends most of its time showing the Pacific. This keeps the Americas and
  // western Europe in view and still reads as alive from the back of a room.
  const CENTRE = -62, SWING = 34, PERIOD_MS = 90_000;
  let t0 = 0;
  setInterval(() => { t0 += 60; rot = CENTRE + SWING * Math.sin((t0 / PERIOD_MS) * 2 * Math.PI); draw(); }, 60);

  const n = v => v == null ? "—" : Number(v).toLocaleString("en-US");
  const el = id => document.getElementById(id);
  async function poll() {
    let d;
    try { d = await (await fetch(`${SERVER}/activity.json?limit=30`)).json(); } catch { return; }
    live = d.live ?? [];
    if (el("gLive")) el("gLive").textContent = String(live.length);
    if (el("gRecords")) el("gRecords").textContent = n(d.totals?.records);
    if (el("gDocs")) el("gDocs").textContent = n(d.totals?.documents_read);
    if (el("gPeople")) el("gPeople").textContent = n(d.totals?.contributors);
    if (el("gPlaces")) el("gPlaces").innerHTML = (d.places ?? []).length
      ? (d.places ?? []).slice(0, 8).map(p => `<li>${esc(p)}</li>`).join("")
      : `<li class="meta">no agent connected yet</li>`;
    if (el("gTicker")) el("gTicker").innerHTML = (d.events ?? []).slice(0, 10)
      .map(e => `<li><span class="k k-${esc(e.kind)}">${esc(e.kind)}</span>${esc(e.headline)}<span class="meta">${esc(e.ago)}</span></li>`).join("");
  }
  await poll();
  setInterval(poll, 5000);
  draw();
})();
