// The readout over the globe.
//
// A rotating Earth with dots on it is pretty and says nothing. This types the actual sentence
// underneath each dot -- which district, which agent, which state -- one character at a time, and
// lets the line decay like phosphor as the next one arrives. A room reads the top line and glances
// at the trail to see how fast it is moving.
//
// Everything typed here comes from the crew's own feed or the claims registry. When nothing is
// happening the trail falls back to the toll, because an idle board in a demo should still be saying
// what the thing is for, and the toll is the reason the project exists.
(() => {
  const host = document.getElementById("gterm");
  if (!host) return;
  const SERVER = "https://escp-mcp-production.up.railway.app";
  const KEEP = 5;                         // lines held on screen, oldest fading out
  const CPS = 42;                         // characters a second; fast enough to keep up, slow enough to read
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const up = s => String(s ?? "").toUpperCase();
  const pad = s => String(s ?? "").replace(/\s+/g, " ").trim();

  // Queue of lines waiting to be typed. Live events jump the queue; the toll fills the gaps.
  const queue = [];
  const said = new Set();                 // event ids already typed, so a poll does not repeat itself
  let idle = [];                          // fallback lines, built once the toll loads
  let idleAt = 0;

  const push = (line) => { if (line) queue.push(line); };

  fetch("/kids/data/toll.json").then(r => r.json()).then(t => {
    const n = v => Number(v).toLocaleString("en-US");
    idle = [
      `TOLL ${n(t.reported.students)} children struck in US public schools, ${t.year}, reported`,
      `TOLL at least ${n(t.reported.instances)} times a child was hit; the count is the districts' own`,
      `TOLL the Department of Education calls its own count "likely underreported"`,
      `RECORD ${n(t.record.districts_sourced)} districts on the public record with a source and a quote`,
      `QUEUE ${n(t.record.unchecked_districts)} districts nobody has checked, ${n(t.record.children_in_unchecked)} children behind them`,
      `LAW ${t.record.states_prohibiting} states prohibit it, ${t.record.states_permitting} still permit it`,
      `JOIN point an agent at the crew server and take one district`,
    ];
  }).catch(() => {});

  // An event, as one line of a console. The verb comes first so the eye can scan the left edge.
  const fromEvent = (e) => {
    const where = pad(e.place && e.place.label);
    const head = pad(e.headline);
    const verb = { claimed: "LEASE", added: "RECORD", approved: "VERIFIED", released: "RELEASE", fetched: "READ" }[e.kind] || up(e.kind);
    return `${verb} ${head}${where ? ` · ${where}` : ""}`;
  };

  async function poll() {
    try {
      const d = await (await fetch(`${SERVER}/activity.json?limit=20`)).json();
      for (const l of (d.live ?? [])) {
        const id = `lease:${l.scope}:${l.agent}`;
        if (said.has(id)) continue;
        said.add(id);
        push(`LEASE ${up(l.scope)} held by ${pad(l.agent) || "an agent"}${l.place ? ` · connected from ${pad(l.place.label)}` : ""}`);
      }
      // Oldest first, so the trail reads in the order things actually happened.
      for (const e of (d.events ?? []).slice().reverse()) {
        const id = `${e.kind}:${e.at}:${e.headline}`;
        if (said.has(id)) continue;
        said.add(id);
        push(fromEvent(e));
      }
      // The set only ever grows while the page is open; on a board left up for a day that is tens of
      // thousands of short strings, which is nothing, but cap it anyway rather than leak.
      if (said.size > 4000) said.clear();
    } catch { /* the board keeps typing the toll rather than showing an error over the globe */ }
  }

  // Typing. One line is under the cursor at a time; finished lines are pushed down and dimmed.
  const done = [];
  let typing = "";
  let at = 0;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const paint = () => {
    const rows = [];
    rows.push(`<p>${esc(typing.slice(0, at))}<span class="cur">&nbsp;</span></p>`);
    done.slice(0, KEEP - 1).forEach((t, i) => rows.push(`<p class="d${i + 1}">${esc(t)}</p>`));
    host.innerHTML = rows.join("");
  };

  const next = () => {
    if (!typing) {
      let line = queue.shift();
      if (!line && idle.length) { line = idle[idleAt % idle.length]; idleAt++; }
      if (!line) { setTimeout(next, 700); return; }
      typing = line; at = 0;
      if (reduce) { at = typing.length; finish(); return; }
    }
    at++;
    paint();
    if (at >= typing.length) { finish(); return; }
    setTimeout(next, 1000 / CPS);
  };

  const finish = () => {
    done.unshift(typing);
    done.length = Math.min(done.length, KEEP);
    // Clear the cursor line before repainting, or the finished line shows twice -- once under the
    // cursor and once at the top of the trail -- for as long as the hold lasts.
    typing = "";
    at = 0;
    paint();
    // Hold a finished line long enough to read it. A backlog of real events gets a shorter hold, so
    // a burst of work does not queue up behind the reading pace.
    setTimeout(next, queue.length > 3 ? 500 : 2200);
  };

  poll();
  setInterval(poll, 5000);
  next();
})();
