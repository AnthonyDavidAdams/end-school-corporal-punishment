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
  for (const c of svg.querySelectorAll("path.county")) {
    const st = c.dataset.state, s = states[st]; if (!s) continue;
    const override = s.status === "legal" && bans[st] && bans[st][norm(c.dataset.name)];
    c.setAttribute("fill", override ? COLORS.banned : COLORS[s.status]); c.setAttribute("stroke", "rgba(255,255,255,.55)"); c.setAttribute("stroke-width", "0.4"); c.style.pointerEvents = "none";
  }
  for (const path of svg.querySelectorAll("path.state")) {
    const code = path.dataset.state, s = states[code]; if (!s) continue;
    path.setAttribute("fill", "transparent"); path.setAttribute("stroke", "#fff"); path.setAttribute("stroke-width", "1.2"); path.style.cursor = "pointer"; path.setAttribute("tabindex", "0"); path.setAttribute("aria-label", `${s.name}: ${LABEL[s.status]}`);
    const show = e => { tip.innerHTML = `<b>${s.name}</b><span class="st">${LABEL[s.status]}${s.year_banned ? ` since ${s.year_banned}` : ""}</span>${s.statute ? `<br>${s.statute}` : ""}<br><span class="st">Click for law, bills, counties and districts</span>`; tip.style.display = "block"; if (e && e.clientX) { const r = box.getBoundingClientRect(); tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 330) + "px"; tip.style.top = (e.clientY - r.top + 14) + "px"; } };
    path.addEventListener("mousemove", e => { path.setAttribute("fill", "rgba(255,255,255,.18)"); show(e); });
    path.addEventListener("mouseleave", () => { path.setAttribute("fill", "transparent"); tip.style.display = "none"; });
    path.addEventListener("focus", show); path.addEventListener("blur", () => tip.style.display = "none");
    const go = () => location.href = `/kids/state/${code}/`;
    path.addEventListener("click", go); path.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  }
  svg.querySelector("#state-borders").setAttribute("stroke", "#fff");
  document.getElementById("legend").innerHTML = Object.entries(COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${LABEL[k]} (${summary.states[k] || 0})</span>`).join("") + `<span><i style="background:${COLORS.banned};outline:2px solid ${COLORS.legal}"></i>County where every recorded district prohibits it, inside a legal state</span>`;
  const jump = document.getElementById("jump"); if (jump) jump.addEventListener("change", () => { if (jump.value) location.href = `/kids/state/${jump.value}/`; });
}
main();
