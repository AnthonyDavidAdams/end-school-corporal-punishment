// Colors the public-domain state map from site/data/states.json. No dependencies.
const COLORS = {
  banned: { fill: "#2f6b3a", hover: "#265a30", label: "Prohibited in public schools" },
  partial: { fill: "#c9a227", hover: "#b08d1f", label: "Legal, but every district has banned it" },
  legal: { fill: "#b3382c", hover: "#962e24", label: "Legal in public schools" }
};
async function main() {
  const [svgText, states, summary] = await Promise.all([
    fetch("/kids/assets/us-states.svg").then(r => r.text()),
    fetch("/kids/data/states.json").then(r => r.json()),
    fetch("/kids/data/summary.json").then(r => r.json())
  ]);
  const host = document.getElementById("map");
  host.innerHTML = svgText;
  const svg = host.querySelector("svg");
  const info = document.getElementById("info");
  for (const path of svg.querySelectorAll("path.state")) {
    const code = path.dataset.state, s = states[code];
    if (!s) continue;
    const c = COLORS[s.status] || COLORS.legal;
    path.setAttribute("fill", c.fill);
    path.setAttribute("stroke", "#fff");
    path.setAttribute("stroke-width", "1");
    path.style.cursor = "pointer";
    path.setAttribute("tabindex", "0");
    path.setAttribute("aria-label", `${s.name}: ${c.label}`);
    const show = () => {
      info.innerHTML = `<h2><a href="/kids/state/${code}/">${s.name}</a></h2><p class="status ${s.status}">${c.label}${s.year_banned ? ` (since ${s.year_banned})` : ""}</p>` +
        (s.statute ? `<p><strong>Law:</strong> ${s.statute}${s.statute_url ? ` <a href="${s.statute_url}" rel="noopener">text</a>` : ""}</p>` : "") +
        (s.limits && s.limits.length ? `<p><strong>Limits:</strong> ${s.limits.join("; ")}</p>` : "") +
        (s.notes ? `<p>${s.notes}</p>` : "") +
        (s.last_verified ? `<p class="meta">Verified ${s.last_verified}</p>` : `<p class="meta">Statute not yet verified. <a href="/kids/state/${code}/">Open the state page.</a></p>`);
    };
    path.addEventListener("mouseenter", () => { path.setAttribute("fill", c.hover); show(); });
    path.addEventListener("mouseleave", () => path.setAttribute("fill", c.fill));
    path.addEventListener("focus", show);
    path.addEventListener("click", () => { location.href = `/kids/state/${code}/`; });
    path.addEventListener("keydown", e => { if (e.key === "Enter") location.href = `/kids/state/${code}/`; });
  }
  const legend = document.getElementById("legend");
  legend.innerHTML = Object.entries(COLORS).map(([k, c]) => `<span><i style="background:${c.fill}"></i>${c.label} (${summary.states[k] || 0})</span>`).join("");
  
}
main();
