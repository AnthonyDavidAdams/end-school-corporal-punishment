// The live board: who is working on this right now, where they are, and what the map looks like as
// they do it. Built to be projected in a room, so everything is large and nothing needs a mouse.
(async () => {
  const host = document.getElementById("livemap");
  if (!host) return;
  const SERVER = "https://escp-mcp-production.up.railway.app";
  const NS = "http://www.w3.org/2000/svg";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const [svgText, states, districts] = await Promise.all([
    fetch("/kids/assets/us-map.svg").then(r => r.text()),
    fetch("/kids/data/states.json").then(r => r.json()),
    fetch("/kids/data/districts.json").then(r => r.json()),
  ]);
  host.innerHTML = svgText;
  const svg = host.querySelector("svg");

  const GREEN = "#2D6A4F", LEGAL = "#9B2C2C", DIM = "#1B2340";
  const counties = [...svg.querySelectorAll("path.county")];
  for (const c of counties) {
    const s = states[c.dataset.state];
    c.setAttribute("fill", !s ? DIM : s.status === "banned" ? GREEN : LEGAL);
    c.setAttribute("stroke", "rgba(255,255,255,.25)");
    c.setAttribute("stroke-width", "0.25");
  }
  for (const p of svg.querySelectorAll("path.state")) {
    p.setAttribute("fill", "none"); p.setAttribute("stroke", "#fff"); p.setAttribute("stroke-width", "1");
    p.style.pointerEvents = "none";
  }
  const borders = svg.querySelector("#state-borders");
  if (borders) { borders.setAttribute("stroke", "#fff"); borders.style.pointerEvents = "none"; }

  // Where a state sits on the canvas, so a lease on "MS" can be pointed at.
  const centre = {};
  for (const p of svg.querySelectorAll("path.state")) {
    const b = p.getBBox();
    centre[p.dataset.state] = [b.x + b.width / 2, b.y + b.height / 2];
  }
  // Albers USA, the same projection the map is drawn in, so a contributor's coordinates land in the
  // right place rather than being pinned to a state.
  const project = ([lat, lon]) => {
    // A coarse affine fit over the lower 48. Good enough for a dot on a wall; this is not cartography.
    const x = (lon + 96) * 8.6 + 487.5, y = (39.5 - lat) * 10.9 + 305;
    return (x > 5 && x < 970 && y > 5 && y < 600) ? [x, y] : null;
  };

  const work = document.createElementNS(NS, "g");
  work.setAttribute("pointer-events", "none");
  svg.append(work);

  const n = v => v == null ? "—" : Number(v).toLocaleString("en-US");
  const el = id => document.getElementById(id);

  let lastEventAt = null;
  async function tick() {
    let d;
    try { d = await (await fetch(`${SERVER}/activity.json?limit=40`)).json(); }
    catch { el("livestatus").textContent = "crew server unreachable"; return; }
    el("livestatus").textContent = "";

    const live = d.live ?? [];
    el("nlive").textContent = String(live.length);
    el("nrecords").textContent = n(d.totals?.records);
    el("ndocs").textContent = n(d.totals?.documents_read);
    el("npeople").textContent = n(d.totals?.contributors);

    // Scopes under active lease glow; everything else returns to its policy colour.
    const leased = new Set(live.map(l => String(l.scope ?? "").slice(0, 2).toUpperCase()).filter(Boolean));
    for (const c of counties) {
      const s = states[c.dataset.state];
      const base = !s ? DIM : s.status === "banned" ? GREEN : LEGAL;
      c.setAttribute("fill", leased.has(c.dataset.state) ? "#C9A227" : base);
    }

    work.textContent = "";
    for (const l of live) {
      const p = l.place && Number.isFinite(l.place.lat) ? project([l.place.lat, l.place.lon]) : null;
      const to = centre[String(l.scope ?? "").slice(0, 2).toUpperCase()];
      if (p && to) {
        // A line from the person to the work. This is the whole point of the picture: somebody in one
        // place, reading a school district's policy in another.
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", p[0]); line.setAttribute("y1", p[1]);
        line.setAttribute("x2", to[0]); line.setAttribute("y2", to[1]);
        line.setAttribute("stroke", "#7CE0A8"); line.setAttribute("stroke-width", "1.4");
        line.setAttribute("opacity", ".55"); line.setAttribute("stroke-dasharray", "5 5");
        line.setAttribute("vector-effect", "non-scaling-stroke");
        work.append(line);
      }
      for (const [xy, r, fill] of [[p, 9, "#7CE0A8"], [to, 7, "#C9A227"]]) {
        if (!xy) continue;
        const halo = document.createElementNS(NS, "circle");
        halo.setAttribute("cx", xy[0]); halo.setAttribute("cy", xy[1]); halo.setAttribute("r", r);
        halo.setAttribute("fill", fill); halo.setAttribute("opacity", ".35");
        halo.innerHTML = `<animate attributeName="r" values="${r};${r * 2.2};${r}" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".45;0;.45" dur="2.4s" repeatCount="indefinite"/>`;
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", xy[0]); dot.setAttribute("cy", xy[1]); dot.setAttribute("r", 3.6);
        dot.setAttribute("fill", fill); dot.setAttribute("stroke", "#0D132D"); dot.setAttribute("stroke-width", "1");
        dot.setAttribute("vector-effect", "non-scaling-stroke");
        work.append(halo, dot);
      }
    }

    el("crew").innerHTML = live.length
      ? live.map(l => `<li><b>${esc(l.place?.label || "somewhere")}</b><span>${esc(l.agent || "an agent")} &middot; ${esc(l.scope || "")}</span></li>`).join("")
      : `<li class="meta">No agent is holding a scope right now. Connect one and it appears here.</li>`;

    const evs = (d.events ?? []).slice(0, 14);
    el("ticker").innerHTML = evs.map(e => {
      const fresh = lastEventAt && e.at > lastEventAt;
      return `<li class="${fresh ? "fresh" : ""}"><span class="k k-${esc(e.kind)}">${esc(e.kind)}</span>${esc(e.headline)}${e.repeated > 1 ? ` <span class="rep">&times;${e.repeated}</span>` : ""}<span class="meta">${esc(e.place?.label || "")}${e.place ? " &middot; " : ""}${esc(e.ago)}</span></li>`;
    }).join("");
    if (evs.length) lastEventAt = evs[0].at;
  }

  await tick();
  setInterval(tick, 5000);
})();
