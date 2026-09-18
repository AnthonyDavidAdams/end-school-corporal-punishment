// Country map with county detail, colored by state status; counties where every recorded district prohibits it are shown green inside legal states.
const COLORS = { banned: "#2D6A4F", partial: "#C05621", legal: "#9B2C2C" };
const LABEL = { banned: "Prohibited in public schools", partial: "Legal, but every district has stopped", legal: "Legal in public schools" };
async function main() {
  const [svgText, states, summary, districts] = await Promise.all([
    fetch("/kids/assets/us-map.svg").then(r => r.text()),
    fetch("/kids/data/states.json").then(r => r.json()),
    fetch("/kids/data/summary.json").then(r => r.json()),
    fetch("/kids/data/districts.json").then(r => r.json())
  ]);
  const host = document.getElementById("map"); host.innerHTML = svgText;
  const svg = host.querySelector("svg"), tip = document.getElementById("stip"), box = host.parentElement;
  const norm = c => String(c || "").toLowerCase().replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/i, "").replace(/^st\.\s/, "st ").replace(/^saint\s/, "st ").replace(/[^a-z0-9 ]/g, "").trim();
  const bans = {}; for (const [st, list] of Object.entries(districts)) { const by = {}; for (const d of list) { const k = norm(d.county); if (k) (by[k] ||= []).push(d.status); } bans[st] = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.every(x => x === "bans")])); }
  // Districts we hold a record for, indexed by county, so a county can say what is known about it.
  const byCounty = {};
  for (const [st, list] of Object.entries(districts)) {
    byCounty[st] = {};
    for (const d of list) { const k = norm(d.county); if (k) (byCounty[st][k] ||= []).push(d); }
  }

  // The SVG paints counties, then state shapes, then #state-borders. Anything drawn to highlight
  // something therefore has to go after all three or the white borders cut across it, which is what
  // made the old highlight look like it was sitting between layers. These two groups are appended
  // last, so they are genuinely on top: live activity underneath, the thing under the cursor above it.
  const NS = "http://www.w3.org/2000/svg";
  const liveLayer = document.createElementNS(NS, "g"); liveLayer.id = "live-layer"; liveLayer.setAttribute("pointer-events", "none");
  const hoverLayer = document.createElementNS(NS, "g"); hoverLayer.id = "hover-layer"; hoverLayer.setAttribute("pointer-events", "none");
  svg.append(liveLayer, hoverLayer);

  const place = (e) => {
    if (!e || !e.clientX) return;
    const r = box.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 330) + "px";
    tip.style.top = (e.clientY - r.top + 14) + "px";
  };
  const clearHover = () => { hoverLayer.textContent = ""; tip.style.display = "none"; };

  for (const c of svg.querySelectorAll("path.county")) {
    const st = c.dataset.state, s = states[st]; if (!s) continue;
    const override = s.status === "legal" && bans[st] && bans[st][norm(c.dataset.name)];
    c.setAttribute("fill", override ? COLORS.banned : COLORS[s.status]);
    c.setAttribute("stroke", "rgba(255,255,255,.55)");
    c.setAttribute("stroke-width", "0.4");
    c.style.cursor = "pointer";

    c.addEventListener("mousemove", (e) => {
      // Trace this county on the top layer rather than tinting the whole state.
      if (hoverLayer.dataset.fips !== c.dataset.fips) {
        hoverLayer.dataset.fips = c.dataset.fips;
        const ring = document.createElementNS(NS, "path");
        ring.setAttribute("d", c.getAttribute("d"));
        // A county is a few pixels across at national zoom, so the outline has to carry the
        // highlight, not the fill. Ink reads against both the red and the green.
        ring.setAttribute("fill", "rgba(255,255,255,.3)");
        ring.setAttribute("stroke", "#0D132D");
        ring.setAttribute("stroke-width", "1.6");
        ring.setAttribute("stroke-linejoin", "round");
        ring.setAttribute("vector-effect", "non-scaling-stroke");
        hoverLayer.textContent = "";
        hoverLayer.append(ring);
      }
      const recs = (byCounty[st] && byCounty[st][norm(c.dataset.name)]) || [];
      const known = recs.length
        ? `<br><span class="st">${recs.slice(0, 4).map((d) => `${d.name}: ${d.status === "bans" ? "prohibits" : d.status === "allows" ? "permits" : d.status}`).join("<br>")}${recs.length > 4 ? `<br>and ${recs.length - 4} more` : ""}</span>`
        : `<br><span class="st">No district policy recorded here yet</span>`;
      tip.innerHTML = `<b>${c.dataset.name}, ${s.name}</b><span class="st">${LABEL[s.status]}${s.year_banned ? ` since ${s.year_banned}` : ""}</span>${known}<br><span class="st">Click for ${s.name}: law, bills, counties and districts</span>`;
      tip.style.display = "block";
      place(e);
    });
    c.addEventListener("mouseleave", clearHover);
    c.addEventListener("click", () => { location.href = `/kids/state/${st}/`; });
  }

  for (const path of svg.querySelectorAll("path.state")) {
    const code = path.dataset.state, s = states[code]; if (!s) continue;
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#fff");
    path.setAttribute("stroke-width", "1.2");
    // The counties take the mouse now; the state shape is kept for its outline and for keyboard use.
    path.style.pointerEvents = "none";
    path.setAttribute("tabindex", "0");
    path.setAttribute("aria-label", `${s.name}: ${LABEL[s.status]}`);
    const show = () => { tip.innerHTML = `<b>${s.name}</b><span class="st">${LABEL[s.status]}${s.year_banned ? ` since ${s.year_banned}` : ""}</span>${s.statute ? `<br>${s.statute}` : ""}<br><span class="st">Enter for law, bills, counties and districts</span>`; tip.style.display = "block"; };
    path.addEventListener("focus", show);
    path.addEventListener("blur", () => tip.style.display = "none");
    path.addEventListener("keydown", (e) => { if (e.key === "Enter") location.href = `/kids/state/${code}/`; });
  }
  svg.querySelector("#state-borders").setAttribute("stroke", "#fff");
  svg.querySelector("#state-borders").style.pointerEvents = "none";
  host.addEventListener("mouseleave", clearHover);
  document.getElementById("legend").innerHTML = Object.entries(COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${LABEL[k]} (${summary.states[k] || 0})</span>`).join("") + `<span><i style="background:${COLORS.banned};outline:2px solid ${COLORS.legal}"></i>County where every recorded district prohibits it, inside a legal state</span>`;
  const jump = document.getElementById("jump"); if (jump) jump.addEventListener("change", () => { if (jump.value) location.href = `/kids/state/${jump.value}/`; });
}
main();
