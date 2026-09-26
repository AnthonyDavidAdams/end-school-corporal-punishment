// The wall. One brick per district; the dark ones are the work. Everything on this page is drawn from
// wall.json (built with the site) and the crew server's public feeds, so a brick lands here within a
// minute of a finding being approved.
(async () => {
  const canvas = document.getElementById("wall");
  if (!canvas) return;
  const SERVER = "https://escp-mcp-production.up.railway.app";
  const MCP = SERVER + "/mcp";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n = (x) => Number(x || 0).toLocaleString("en-US");
  const COLOR = { b: "#2D6A4F", a: "#9B2C2C", c: "#C05621", s: "#5A6577", u: "#3A4466", "-": null, new: "#B7791F" };
  const LABEL = { b: "board prohibits it", a: "board permits it", c: "permitted with parental consent", s: "documents read, no rule found", u: "on the record, no source yet", "-": "nobody has read its policy", new: "landed just now" };

  const wall = await fetch("/kids/data/wall.json").then((r) => r.json());
  const states = wall.states;
  const ctx = canvas.getContext("2d");
  const tip = document.getElementById("wtip");

  // ---- layout: same brick size in every column, chosen so the tallest column fits the board ----
  let L = null;
  function layout() {
    const W = canvas.clientWidth || 900;
    const dpr = window.devicePixelRatio || 1;
    const gap = 8, head = 34, maxH = Math.min(720, Math.max(420, window.innerHeight - 260));
    const colW = (W - gap * (states.length - 1)) / states.length;
    const tallest = Math.max(...states.map((s) => s.total));
    let size = 12, per = 1, rows = 1;
    for (size = 12; size >= 2; size--) { per = Math.max(1, Math.floor((colW + 1) / (size + 1))); rows = Math.ceil(tallest / per); if (rows * (size + 1) + head <= maxH) break; }
    const H = rows * (size + 1) + head + 6;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    L = { W, H, gap, head, colW, size, per, rows, dpr };
    // Each brick's resting place: columns fill from the floor, left to right within a row.
    states.forEach((s, ci) => {
      const x0 = ci * (colW + gap);
      const usable = per * (size + 1) - 1, pad = (colW - usable) / 2;
      s.x0 = x0; s.bricks.forEach((b, i) => { b.x = x0 + pad + (i % per) * (size + 1); b.y = H - 6 - (Math.floor(i / per) + 1) * (size + 1) + 1; });
    });
  }

  // ---- drawing, with the drop animation ----
  const drops = new Map(); // brick -> {start, from}
  let raf = null;
  function draw(now) {
    const { W, H, head, size, colW } = L;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0D132D"; ctx.fillRect(0, 0, W, H);
    let animating = false;
    for (const s of states) {
      // column header: code, placed / total, and a thin progress bar
      const pct = s.placed / s.total;
      ctx.fillStyle = "#E8ECF1"; ctx.font = `700 ${Math.max(10, Math.min(13, colW / 3.2))}px 'Source Sans 3', system-ui, sans-serif`; ctx.textAlign = "center";
      ctx.fillText(s.code, s.x0 + colW / 2, 13);
      ctx.fillStyle = "#8B95A5"; ctx.font = `${Math.max(8, Math.min(10, colW / 4.2))}px 'Source Sans 3', system-ui, sans-serif`;
      ctx.fillText(`${s.placed}/${s.total}`, s.x0 + colW / 2, 24);
      ctx.fillStyle = "#2A3352"; ctx.fillRect(s.x0, head - 6, colW, 2);
      ctx.fillStyle = pct >= 1 ? "#B7791F" : "#2D6A4F"; ctx.fillRect(s.x0, head - 6, colW * pct, 2);
      for (const b of s.bricks) {
        let y = b.y;
        const d = drops.get(b);
        if (d) { const t = Math.min(1, (now - d.start) / d.ms); if (t < 0) { animating = true; continue; } const e = 1 - Math.pow(1 - t, 3); y = d.from + (b.y - d.from) * e; if (t < 1) animating = true; else drops.delete(b); }
        const c = COLOR[b.s];
        if (c) { ctx.fillStyle = c; ctx.fillRect(b.x, y, size, size); }
        else { ctx.strokeStyle = b.k ? "#4A5680" : "#2A3352"; ctx.lineWidth = 1; ctx.strokeRect(b.x + .5, y + .5, size - 1, size - 1); }
        if (b === hot) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.strokeRect(b.x - 1, y - 1, size + 2, size + 2); }
      }
    }
    raf = animating ? requestAnimationFrame(draw) : null;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(draw); };
  function dropAll() {
    // On load the whole wall falls into place, column by column, filled bricks first: a second and a
    // half of motion that says what the page is before a word is read.
    const t0 = performance.now();
    states.forEach((s, ci) => s.bricks.forEach((b, i) => { if (COLOR[b.s]) drops.set(b, { start: t0 + ci * 40 + i * 0.6, ms: 500, from: -20 }); }));
    kick();
  }
  function land(b) { drops.set(b, { start: performance.now(), ms: 700, from: -30 }); kick(); }

  // ---- hit testing, tooltip, claim panel ----
  let hot = null;
  function at(ev) {
    const r = canvas.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const ci = Math.floor(x / (L.colW + L.gap)); const s = states[ci]; if (!s) return null;
    for (const b of s.bricks) if (x >= b.x && x < b.x + L.size && y >= b.y && y < b.y + L.size) return { s, b };
    return null;
  }
  canvas.addEventListener("mousemove", (ev) => {
    const h = at(ev);
    if (!h) { tip.hidden = true; if (hot) { hot = null; kick(); } return; }
    if (h.b !== hot) { hot = h.b; kick(); }
    tip.innerHTML = `<b>${esc(h.b.n)}</b>, ${esc(h.s.name)}<br>${esc(LABEL[h.b.s])}${h.b.k ? `<br>${n(h.b.k)} students struck in 2023-24` : ""}${COLOR[h.b.s] ? "" : "<br><i>click to take it</i>"}`;
    tip.hidden = false;
    const r = canvas.getBoundingClientRect(); tip.style.left = Math.min(ev.clientX - r.left + 14, r.width - 270) + "px"; tip.style.top = (ev.clientY - r.top + 14) + "px";
  });
  canvas.addEventListener("mouseleave", () => { tip.hidden = true; hot = null; kick(); });
  canvas.addEventListener("click", (ev) => { const h = at(ev); if (h) showClaim(h.s, h.b); });

  const claimBox = document.getElementById("wclaim");
  function showClaim(s, b) {
    const prompt = COLOR[b.s] && b.s !== "u"
      ? `Connect to the End School Corporal Punishment crew at ${MCP}, call get_record for "${b.n}" in ${s.code}, open its source, and check that the quoted sentence is still in the district's current policy. If it changed, submit_finding with the new sentence.`
      : `Connect to the End School Corporal Punishment crew at ${MCP}. Call get_started, then claim_task for "${b.n}" in ${s.code} (federal id ${b.i}). Find the district's own student handbook or board policy, quote the sentence on corporal punishment verbatim with its URL, and submit_finding. If no document says anything, say so in the finding.`;
    claimBox.innerHTML = `<h2>${esc(b.n)}</h2><p class="meta">${esc(s.name)} &middot; ${esc(LABEL[b.s])}${b.k ? ` &middot; ${n(b.k)} students struck in 2023-24` : ""}</p>
      <p style="margin:.4rem 0 0;font-size:.85rem">Paste this into your agent:</p><div class="wclaimbox" id="wPrompt">${esc(prompt)}</div>
      <button type="button" class="wbtn" id="wCopy">Copy the instruction</button>
      <a class="wbtn alt" href="/kids/connect/" style="text-align:center;text-decoration:none;margin-top:.4rem">Not connected yet? Connect an agent</a>
      <button type="button" id="wNext" class="wbtn alt">Give me the biggest dark brick</button>`;
    document.getElementById("wCopy").addEventListener("click", async (e) => { try { await navigator.clipboard.writeText(prompt); e.target.textContent = "Copied. Hand it over."; } catch { e.target.textContent = "Select the text and copy it"; } });
    wireNext();
    hot = b; kick();
  }
  function biggestDark() {
    let best = null;
    for (const s of states) for (const b of s.bricks) if (!COLOR[b.s] && (!best || b.k > best.b.k)) best = { s, b };
    if (!best || !best.b.k) { const s = states[0]; const b = s.bricks.find((x) => !COLOR[x.s]); if (b) best = { s, b }; }
    return best;
  }
  function wireNext() { const el = document.getElementById("wNext"); if (el) el.addEventListener("click", () => { const h = biggestDark(); if (h) showClaim(h.s, h.b); }); }
  wireNext();

  // ---- the crew: leaderboard, ladder, live drops ----
  const score = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  let lb = null;
  async function leaderboard() {
    try { lb = await (await fetch(`${SERVER}/leaderboard.json`, { cache: "no-store" })).json(); } catch { lb = null; }
    if (!lb) { try { const c = await (await fetch(`${SERVER}/crew.json`)).json(); lb = { all_time: c.members.map((m, i) => ({ rank: i + 1, ...m, rungs: [] })), this_week: [], totals: { contributors: c.contributors_total }, ladder: [] }; } catch { return; } }
    score("wCrew", n(lb.totals?.contributors)); if (lb.totals?.this_week != null) score("wWeek", n(lb.totals.this_week));
    const lad = document.getElementById("wLadder"); if (lad && lb.ladder?.length) lad.innerHTML = lb.ladder.map((s) => `<li>${esc(s.title)}</li>`).join("");
    renderLeaders("all");
  }
  function renderLeaders(tab) {
    const ol = document.getElementById("wLeaders"); if (!ol || !lb) return;
    const rows = tab === "week" ? lb.this_week : lb.all_time.slice(0, 25);
    if (!rows.length) { ol.innerHTML = `<li class="meta" style="display:block">${tab === "week" ? "Nothing landed this week yet. Be first." : "No bricks placed yet."}</li>`; return; }
    const rungs = lb.ladder?.map((s) => s.id) ?? [];
    ol.innerHTML = rows.map((r) => `<li><span>${esc(r.display_name || `contributor ${r.id}`)}${r.tier ? ` <span class="r">${esc(r.tier)}</span>` : ""}</span><span class="r">${tab === "week" ? `${n(r.this_week)} this week` : `${n(r.districts)} bricks${r.children ? ` · ${n(r.children)} kids` : ""}`}${rungs.length && r.rungs ? ` <span class="dots">${rungs.map((id) => `<i class="${r.rungs.includes(id) ? "on" : ""}" title="${esc(id)}"></i>`).join("")}</span>` : ""}</span></li>`).join("");
  }
  document.querySelectorAll(".wtabs button").forEach((b) => b.addEventListener("click", () => { document.querySelectorAll(".wtabs button").forEach((x) => x.classList.toggle("on", x === b)); renderLeaders(b.dataset.tab); }));

  const seen = new Set(); let first = true;
  const key = (s) => String(s || "").toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/[^a-z0-9]/g, "");
  function findBrick(subject) {
    const m = String(subject || "").match(/^(.*),\s*([A-Z]{2})$/); if (!m) return null;
    const s = states.find((x) => x.code === m[2]); if (!s) return null;
    const k = key(m[1]); const b = s.bricks.find((x) => key(x.n) === k); return b ? { s, b } : null;
  }
  async function poll() {
    let d; try { d = await (await fetch(`${SERVER}/activity.json?limit=60`, { cache: "no-store" })).json(); } catch { return; }
    const feed = document.getElementById("wFeed"); const items = [];
    for (const e of [...(d.events || [])].reverse()) {
      const id = `${e.at}|${e.kind}|${e.subject}`; if (seen.has(id)) continue; seen.add(id);
      if (!/^(verified|recorded|approved|merged)/.test(e.kind) && !e.sourced) continue;
      const h = findBrick(e.scope || e.subject);
      if (h && !COLOR[h.b.s] && !first) { h.b.s = "new"; h.s.placed++; land(h.b); score("wPlaced", n(++wall.totals.placed)); score("wDark", n(wall.totals.bricks - wall.totals.placed)); score("wPct", Math.round(100 * wall.totals.placed / wall.totals.bricks) + "%"); }
      items.push(`<li>${esc(e.headline || e.subject)}<time>${esc(e.ago || "")}</time></li>`);
    }
    if (feed && items.length) feed.innerHTML = items.slice(-12).reverse().join("") + (first ? "" : feed.innerHTML).slice(0, 4000);
    if (feed && first && !items.length) feed.innerHTML = `<li class="meta">Nothing in the last hour. <a href="/kids/connect/">Bring an agent</a> and the next brick is yours.</li>`;
    first = false;
  }

  layout(); dropAll();
  window.addEventListener("resize", () => { layout(); kick(); });
  leaderboard(); poll();
  setInterval(poll, 20000); setInterval(leaderboard, 60000);
})();
