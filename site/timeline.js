// The animated map: 160 years of states prohibiting corporal punishment, and then the last twenty in
// which districts started doing it themselves inside the states that never did.
//
// Districts are placed on their county's path, taken from the same SVG the county map uses, so there
// is no second set of coordinates to keep in step with the first.
(async () => {
  const host = document.getElementById("tmap");
  if (!host) return;
  const [svgText, tl, states] = await Promise.all([
    fetch("/kids/assets/us-map.svg").then(r => r.text()),
    fetch("/kids/data/timeline.json").then(r => r.json()),
    fetch("/kids/data/states.json").then(r => r.json()),
  ]);
  host.innerHTML = svgText;
  const svg = host.querySelector("svg");
  const NS = "http://www.w3.org/2000/svg";

  const GREEN = "#2D6A4F", GREEN_UNDATED = "#4E8C6F", LEGAL = "#9B2C2C", DIM = "#E7E2D9";
  const banYear = Object.fromEntries(tl.states.map(s => [s.code, s.year]));
  // New Hampshire and the District of Columbia prohibit corporal punishment and this project does not
  // hold the year either of them did it. They are drawn as prohibiting for the whole animation, in a
  // lighter green, because inventing a year would be worse and drawing them red would make the last
  // frame wrong about a place where it is illegal.
  const undatedBan = new Set((tl.states_banned_undated || []).map(s => s.code));
  const statePaths = [...svg.querySelectorAll("path.state")];
  const countyPaths = [...svg.querySelectorAll("path.county")];

  // Counties carry the fill, as on the main map; the state outline stays on top.
  for (const c of countyPaths) { c.setAttribute("stroke", "rgba(255,255,255,.4)"); c.setAttribute("stroke-width", "0.3"); }
  for (const p of statePaths) { p.setAttribute("fill", "none"); p.setAttribute("stroke", "#fff"); p.setAttribute("stroke-width", "1.1"); p.style.pointerEvents = "none"; }
  const borders = svg.querySelector("#state-borders");
  if (borders) { borders.setAttribute("stroke", "#fff"); borders.style.pointerEvents = "none"; }

  const pins = document.createElementNS(NS, "g");
  pins.setAttribute("pointer-events", "none");
  svg.append(pins);

  const norm = c => String(c || "").toLowerCase().replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/i, "").replace(/^st\.\s/, "st ").replace(/^saint\s/, "st ").replace(/[^a-z0-9 ]/g, "").trim();
  const countyIndex = {};
  for (const c of countyPaths) ((countyIndex[c.dataset.state] ||= {})[norm(c.dataset.name)] ||= c);

  // A district is drawn on its county where the record names one, and on the state's centre otherwise,
  // which is honest about the resolution we actually have for it.
  const stateCentre = {};
  for (const p of statePaths) { const b = p.getBBox(); stateCentre[p.dataset.state] = [b.x + b.width / 2, b.y + b.height / 2]; }
  for (const d of tl.districts) {
    const path = d.county && countyIndex[d.state] && countyIndex[d.state][norm(d.county)];
    if (path) { const b = path.getBBox(); d.xy = [b.x + b.width / 2, b.y + b.height / 2]; d.placed = "county"; }
    else if (stateCentre[d.state]) { d.xy = stateCentre[d.state]; d.placed = "state"; }
  }

  const YEARS = [];
  for (let y = tl.first_year; y <= tl.last_year; y++) YEARS.push(y);
  const scrub = document.getElementById("tyear");
  const play = document.getElementById("tplay");
  const label = document.getElementById("tlabel");
  const caption = document.getElementById("tcaption");
  scrub.min = String(tl.first_year); scrub.max = String(tl.last_year); scrub.value = String(tl.last_year);

  function render(year) {
    for (const c of countyPaths) {
      const st = c.dataset.state;
      if (undatedBan.has(st)) { c.setAttribute("fill", GREEN_UNDATED); continue; }
      const banned = banYear[st] !== undefined && banYear[st] <= year;
      c.setAttribute("fill", banned ? GREEN : states[st] ? LEGAL : DIM);
    }
    pins.textContent = "";
    let shown = 0, kids = 0;
    for (const d of tl.districts) {
      if (!d.xy || d.year > year) continue;
      shown++; if (d.students) kids += d.students;
      const age = year - d.year;
      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("cx", d.xy[0]); halo.setAttribute("cy", d.xy[1]);
      // A new prohibition flares for a couple of years and then settles into a steady dot, so the eye
      // is drawn to what just changed rather than to the accumulated total.
      halo.setAttribute("r", age <= 1 ? 13 : 7);
      halo.setAttribute("fill", "#7CE0A8");
      halo.setAttribute("opacity", age <= 1 ? 0.5 : 0.22);
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", d.xy[0]); dot.setAttribute("cy", d.xy[1]);
      dot.setAttribute("r", 3.4);
      dot.setAttribute("fill", "#B7F7CE");
      dot.setAttribute("stroke", "#0D132D"); dot.setAttribute("stroke-width", "0.9");
      dot.setAttribute("vector-effect", "non-scaling-stroke");
      pins.append(halo, dot);
    }
    const nStates = tl.states.filter(s => s.year <= year).length + undatedBan.size;
    label.textContent = String(year);
    const justNow = tl.districts.filter(d => d.year === year);
    const statesNow = tl.states.filter(s => s.year === year);
    caption.innerHTML =
      `<b>${nStates}</b> states prohibit it &middot; <b>${shown}</b> districts in this record prohibit it where their state does not` +
      (kids ? ` &middot; <b>${kids.toLocaleString()}</b> children covered by a district that had reported striking them` : "") +
      (statesNow.length ? `<br><span class="hl">${statesNow.map(s => s.name).join(", ")} prohibited it this year</span>` : "") +
      (justNow.length ? `<br><span class="hl">${justNow.map(d => d.name).join(", ")}</span>` : "");
  }

  // The nineteenth century is nearly empty and the last fifteen years are where everything happens, so
  // the playhead moves fast through the quiet stretch and slows down where there is something to read.
  const dwell = (y) => (y < 1970 ? 55 : y < 2000 ? 110 : y < 2015 ? 320 : 520);
  let timer = null, playing = false;
  function stop() { clearTimeout(timer); timer = null; playing = false; play.textContent = "Play"; }
  function step() {
    const y = Number(scrub.value) + 1;
    if (y > tl.last_year) { stop(); return; }
    scrub.value = String(y);
    render(y);
    timer = setTimeout(step, dwell(y));
  }
  function start() {
    if (Number(scrub.value) >= tl.last_year) { scrub.value = String(tl.first_year); render(tl.first_year); }
    playing = true; play.textContent = "Pause";
    timer = setTimeout(step, dwell(Number(scrub.value)));
  }
  play.addEventListener("click", () => (playing ? stop() : start()));
  scrub.addEventListener("input", () => { stop(); render(Number(scrub.value)); });
  // ?year=2004 opens on that year, so a particular moment can be linked to.
  const asked = Number(new URLSearchParams(location.search).get("year"));
  const startAt = Number.isFinite(asked) && asked >= tl.first_year && asked <= tl.last_year ? asked : tl.last_year;
  scrub.value = String(startAt);
  render(startAt);
  document.getElementById("tundated").textContent = tl.districts_prohibiting_without_a_date;
})();
