// The arcade. Every invader is a school district where a teacher may still hit a child and nobody has
// read the district's own rule. Crew ships beam them up: a real finding lands on the crew server, the
// invader on screen is pulled down into the record. A visitor can fly too: lock on to a district and
// the page hands them the exact instruction for their agent. Nothing here is decorative -- the
// formation is the federal directory, the ships are contributors, and the beams are the activity feed.
(async () => {
  const canvas = document.getElementById("arcade"); if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const SERVER = "https://escp-mcp-production.up.railway.app", MCP = SERVER + "/mcp";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const n = (x) => Number(x || 0).toLocaleString("en-US");
  const $ = (id) => document.getElementById(id);

  // ---- data: the formation is the record's dark districts, state by state, most struck first ----
  const wall = await fetch("/kids/data/wall.json").then((r) => r.json());
  const dark = (b) => b.s === "-" || b.s === "u";
  const waves = wall.states.map((s) => ({ code: s.code, name: s.name, pool: s.bricks.filter(dark).sort((a, b) => b.k - a.k), total: s.total, placed: s.placed })).filter((w) => w.pool.length);
  const totals = { record: wall.totals.placed, dark: wall.totals.bricks - wall.totals.placed };
  let waveIx = 0;

  // ---- sprites (pixel maps) ----
  const INV = [[
    "..#.....#..", "...#...#...", "..#######..", ".##.###.##.", "###########", "#.#######.#", "#.#.....#.#", "...##.##..."],
    ["..#.....#..", "#..#...#..#", "#.#######.#", "###.###.###", "###########", ".#########.", "..#.....#..", ".#.......#."]];
  const SHIP = ["....#....", "...###...", "..#####..", ".#######.", "#########", "#..###..#", "...#.#..."];
  const YOU = ["....#....", "...###...", "...###...", ".#######.", "#########", "##.###.##", "#...#...#"];
  function sprite(map, x, y, px, color) { ctx.fillStyle = color; map.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === "#") ctx.fillRect(x + c * px, y + r * px, px, px); }); }

  // ---- layout ----
  let W = 960, H = 540, PX = 3, COLS = 12, ROWS = 6, cellW = 0, cellH = 0, gridX = 0, gridY = 70, floorY = 0;
  function layout() {
    W = canvas.clientWidth || 960; H = Math.round(W * 9 / 16); const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    COLS = W < 600 ? 8 : 12; ROWS = W < 600 ? 5 : 6; PX = W < 600 ? 2 : 3;
    cellW = Math.floor((W * 0.86) / COLS); cellH = Math.floor(cellW * 0.78); gridX = Math.floor((W - cellW * COLS) / 2); gridY = 64; floorY = H - 70;
  }

  // ---- the formation ----
  const inv = []; // {b, col, row, state, y0 (fall offset), hit, target}
  let form = { x: 0, dir: 1, drop: 0, speed: 0.35 }, frame = 0, wave = null;
  function load(ix) {
    waveIx = (ix + waves.length) % waves.length; wave = waves[waveIx]; inv.length = 0; form = { x: 0, dir: 1, drop: 0, speed: 0.35 + Math.min(0.5, waveIx * 0.03) };
    wave.pool.slice(0, COLS * ROWS).forEach((b, i) => inv.push({ b, col: i % COLS, row: Math.floor(i / COLS), fall: -(Math.floor(i / COLS) + 1) * 40 - Math.random() * 200, state: "alive" }));
    wave.next = Math.min(wave.pool.length, COLS * ROWS);
    $("hudWave").textContent = `WAVE ${waveIx + 1}/${waves.length} · ${wave.name.toUpperCase()} · ${n(wave.pool.length)} LEFT`;
    banner(`WAVE ${waveIx + 1}: ${wave.name.toUpperCase()}`, `${n(wave.pool.length)} districts, no written rule on the record`);
  }
  function refill(slot) {
    if (wave.next >= wave.pool.length) return;
    const b = wave.pool[wave.next++]; slot.b = b; slot.state = "alive"; slot.fall = -300; slot.hit = 0; slot.target = false;
  }
  const pos = (s) => ({ x: gridX + s.col * cellW + form.x + (cellW - 11 * PX) / 2, y: gridY + s.row * cellH + form.drop + (s.fall < 0 ? s.fall : 0) });

  // ---- ships: the crew, and you ----
  const ships = new Map(); // id -> {id, name, x, tx, beam, color}
  const COLORS = ["#7DD3FC", "#F9A8D4", "#A7F3D0", "#FDE68A", "#C4B5FD", "#FCA5A5"];
  function ship(id, name) {
    if (!ships.has(id)) ships.set(id, { id, name: name || `crew ${id}`, x: 60 + Math.random() * (W - 120), tx: null, beam: 0, color: COLORS[ships.size % COLORS.length], score: 0 });
    return ships.get(id);
  }
  const you = { x: W / 2, vx: 0, beam: 0, locks: 0 };

  // ---- events from the crew server ----
  const seen = new Set(); let booted = false; const queue = [];
  const key = (s) => String(s || "").toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/[^a-z0-9]/g, "");
  function findSlot(subject) {
    const m = String(subject || "").match(/^(.*),\s*([A-Z]{2})$/); if (!m || !wave || m[2] !== wave.code) return null;
    const k = key(m[1]); return inv.find((s) => s.state === "alive" && key(s.b.n) === k) || null;
  }
  function act(e) {
    const who = ship(e.contributor || "crew", e.contributor ? `pilot ${e.contributor}` : "crew");
    const slot = findSlot(e.scope || e.subject);
    const label = String(e.subject || e.scope || "").replace(/,\s*[A-Z]{2}$/, "");
    if (e.kind === "claimed") {
      if (slot) { who.tx = pos(slot).x + 11 * PX / 2; who.beam = 120; slot.hit = 30; }
      feed(`${esc(who.name)} locked on ${esc(label)}`, e.ago);
    } else if (/^(verified|recorded|machine)/.test(e.kind) || e.sourced) {
      who.score++;
      if (slot) { who.tx = pos(slot).x + 11 * PX / 2; who.beam = 150; slot.state = "beamed"; slot.t = 0; slot.by = who; }
      else pop(12, gridY - 8, `+1 ${label.slice(0, 26)} (${String(e.scope || e.subject || "").slice(-2)})`, "#A7F3D0");
      totals.record++; totals.dark = Math.max(0, totals.dark - 1); hud();
      feed(`${esc(who.name)} put ${esc(label)} on the record`, e.ago, true);
    } else if (e.kind === "attempted") {
      if (slot) { who.tx = pos(slot).x + 11 * PX / 2; who.beam = 60; slot.hit = 20; }
      feed(`${esc(who.name)} tried ${esc(label)}: no readable source yet`, e.ago);
    }
  }
  async function poll() {
    let d; try { d = await (await fetch(`${SERVER}/activity.json?limit=60`, { cache: "no-store" })).json(); } catch { return; }
    const fresh = [...(d.events || [])].reverse().filter((e) => { const id = `${e.at}|${e.kind}|${e.subject}`; if (seen.has(id)) return false; seen.add(id); return true; });
    if (!booted) { booted = true; queue.push(...fresh.slice(-30)); } else queue.push(...fresh);
    if (d.live?.length) $("hudPilots").textContent = `${d.live.length} FLYING NOW`;
  }
  setInterval(() => { const e = queue.shift(); if (e) act(e); }, 900);

  // ---- leaderboard ----
  async function board() {
    let lb; try { lb = await (await fetch(`${SERVER}/leaderboard.json`, { cache: "no-store" })).json(); } catch { return; }
    $("hudWeek").textContent = `${n(lb.totals?.this_week)} THIS WEEK`;
    const ol = $("pLeaders"); if (!ol) return;
    const rows = (lb.all_time || []).slice(0, 10);
    ol.innerHTML = rows.length ? rows.map((r) => `<li><span>${esc(r.display_name || `pilot ${r.id}`)}${r.tier ? ` <em>${esc(r.tier)}</em>` : ""}</span><b>${n(r.districts)}</b></li>`).join("") : `<li class="meta">No pilots yet. First one gets the top line.</li>`;
    for (const r of rows.slice(0, 6)) ship(r.id, r.display_name || `pilot ${r.id}`);
  }

  // ---- HUD, toasts, feed ----
  function hud() { $("hudRecord").textContent = `${n(totals.record)} ON THE RECORD`; $("hudDark").textContent = `${n(totals.dark)} STILL DARK`; }
  const pops = []; function pop(x, y, text, color) { pops.push({ x, y, text, color, t: 0 }); }
  let ban = null; function banner(a, b) { ban = { a, b, t: 0 }; }
  function feed(html, ago, strong) { const ul = $("pFeed"); if (!ul) return; const li = document.createElement("li"); if (strong) li.className = "on"; li.innerHTML = `${html}<time>${esc(ago || "")}</time>`; ul.prepend(li); while (ul.children.length > 10) ul.lastChild.remove(); }

  // ---- the target card: what a visitor hands their agent ----
  function lock(slot) {
    slot.target = true; you.locks++; $("hudYou").textContent = `${you.locks} HANDED TO YOUR AGENT`;
    const b = slot.b, st = wave.code;
    const prompt = `Connect to the End School Corporal Punishment crew at ${MCP}. Call get_started, then claim_task for "${b.n}" in ${st} (federal id ${b.i}). Find the district's own student handbook or board policy, quote the sentence on corporal punishment verbatim with its URL, and submit_finding. If no document says anything, say so in the finding.`;
    $("pTarget").innerHTML = `<h2>Locked: ${esc(b.n)}</h2><p class="meta">${esc(wave.name)}${b.k ? ` · ${n(b.k)} students struck in 2023-24` : ""} · no written rule on the record</p>
      <p class="small">Your ship cannot read a policy. Your agent can. Paste this and it will beam the district up for real:</p>
      <div class="pbox">${esc(prompt)}</div><button type="button" class="pbtn" id="pCopy">Copy for my agent</button>
      <a class="pbtn alt" href="/kids/connect/">Connect an agent first</a>`;
    $("pCopy").addEventListener("click", async (e) => { try { await navigator.clipboard.writeText(prompt); e.target.textContent = "Copied. Go."; } catch { e.target.textContent = "Select and copy the text"; } });
    pop(pos(slot).x, pos(slot).y - 10, "LOCKED", "#FDE68A");
  }

  // ---- input ----
  const keys = {}; let touchX = null;
  // Space fires on the keydown itself: a quick tap can begin and end between two frames, and a lock
  // that only registers when the key is held reads as a broken game.
  addEventListener("keydown", (e) => { if (["ArrowLeft", "ArrowRight", " ", "a", "d"].includes(e.key)) { keys[e.key] = true; if (e.key === " ") fire(); if (e.target === document.body) e.preventDefault(); } });
  addEventListener("keyup", (e) => { keys[e.key] = false; });
  canvas.addEventListener("pointerdown", (e) => { const r = canvas.getBoundingClientRect(); touchX = e.clientX - r.left; fire(); });
  canvas.addEventListener("pointermove", (e) => { if (touchX != null) { const r = canvas.getBoundingClientRect(); touchX = e.clientX - r.left; } });
  addEventListener("pointerup", () => { touchX = null; });
  let fireCd = 0;
  function fire() {
    if (fireCd > 0 || !wave) return; fireCd = 25; you.beam = 40;
    const hit = inv.filter((s) => s.state === "alive" && Math.abs(pos(s).x + 11 * PX / 2 - you.x) < cellW / 2).sort((a, b) => b.row - a.row)[0];
    if (hit) { hit.hit = 25; lock(hit); }
  }

  // ---- main loop ----
  let last = performance.now(), ftime = 0;
  function tick(now) {
    const dt = Math.min(50, now - last); last = now; ftime += dt; if (ftime > 450) { ftime = 0; frame ^= 1; }
    // formation march
    const alive = inv.filter((s) => s.state === "alive");
    const minC = Math.min(...alive.map((s) => s.col), COLS), maxC = Math.max(...alive.map((s) => s.col), -1);
    const left = gridX + minC * cellW + form.x, right = gridX + (maxC + 1) * cellW + form.x;
    form.x += form.dir * form.speed * dt / 16;
    if (right > W - 8 && form.dir > 0) { form.dir = -1; form.drop += 8; } if (left < 8 && form.dir < 0) { form.dir = 1; form.drop += 8; }
    if (gridY + ROWS * cellH + form.drop > floorY - 40) form.drop = 0;
    for (const s of inv) { if (s.fall < 0) s.fall = Math.min(0, s.fall + dt * 0.5); if (s.hit > 0) s.hit--; if (s.state === "beamed") { s.t += dt; if (s.t > 900) { s.state = "gone"; setTimeout(() => refill(s), 600 + Math.random() * 1500); } } }
    if (wave && !inv.some((s) => s.state !== "gone") && wave.next >= wave.pool.length) load(waveIx + 1);
    // you
    if (keys.ArrowLeft || keys.a) you.x -= 0.45 * dt; if (keys.ArrowRight || keys.d) you.x += 0.45 * dt; if (touchX != null) you.x += (touchX - you.x) * 0.2;
    if (fireCd > 0) fireCd--; you.x = Math.max(20, Math.min(W - 20, you.x)); if (you.beam > 0) you.beam--;
    for (const s of ships.values()) { if (s.tx != null) { s.x += (s.tx - s.x) * 0.08; if (Math.abs(s.tx - s.x) < 1) s.tx = null; } else s.x += Math.sin(now / 1700 + s.id.length) * 0.15; if (s.beam > 0) s.beam--; }

    // draw
    ctx.fillStyle = "#06091A"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,.5)"; for (let i = 0; i < 60; i++) { const sx = (i * 977) % W, sy = ((i * 613) + now * 0.01 * (1 + i % 3)) % H; ctx.fillRect(sx, sy, 1, 1); }
    ctx.strokeStyle = "#1B2340"; ctx.beginPath(); ctx.moveTo(0, floorY + 24); ctx.lineTo(W, floorY + 24); ctx.stroke();
    for (const s of inv) {
      if (s.state === "gone") continue; const p = pos(s);
      if (s.state === "beamed") { const k = s.t / 900; const y = p.y + (floorY - p.y) * k * k; ctx.globalAlpha = 1 - k * 0.7; sprite(INV[frame], p.x, y, PX, s.b.k ? "#A7F3D0" : "#86EFAC"); ctx.globalAlpha = 1; if (s.t < 40) pop(p.x, p.y - 8, `+${s.b.k ? n(s.b.k) + " kids" : "1"}`, "#A7F3D0"); continue; }
      const color = s.target ? "#FDE68A" : s.hit > 0 ? "#FFFFFF" : s.b.k > 100 ? "#EF6B6B" : s.b.k ? "#B94A4A" : "#7A3B4F";
      sprite(INV[frame], p.x, p.y, PX, color);
      if (s.b.k >= 50 && PX >= 3) { ctx.fillStyle = "#FDE68A"; ctx.font = "9px 'Source Sans 3', system-ui"; ctx.textAlign = "center"; ctx.fillText(n(s.b.k), p.x + 11 * PX / 2, p.y + 8 * PX + 10); }
    }
    for (const s of ships.values()) {
      if (s.beam > 0) { const g = ctx.createLinearGradient(0, gridY, 0, floorY); g.addColorStop(0, "rgba(183,121,31,0)"); g.addColorStop(1, s.color); ctx.fillStyle = g; ctx.fillRect(s.x - 2, gridY, 4, floorY - gridY); }
      sprite(SHIP, s.x - 4.5 * PX, floorY, PX, s.color);
      ctx.fillStyle = s.color; ctx.font = "10px 'Source Sans 3', system-ui"; ctx.textAlign = "center"; ctx.fillText(s.name.slice(0, 16), s.x, floorY + 7 * PX + 12);
    }
    if (you.beam > 0) { ctx.fillStyle = "rgba(253,230,138,.9)"; ctx.fillRect(you.x - 1.5, gridY, 3, floorY - gridY); }
    sprite(YOU, you.x - 4.5 * PX, floorY - 2, PX, "#FFFFFF"); ctx.fillStyle = "#fff"; ctx.font = "700 10px 'Source Sans 3', system-ui"; ctx.textAlign = "center"; ctx.fillText("YOU", you.x, floorY + 7 * PX + 12);
    for (const p of pops) { p.t += dt; ctx.globalAlpha = Math.max(0, 1 - p.t / 1400); ctx.fillStyle = p.color; ctx.font = "700 12px 'Source Sans 3', system-ui"; ctx.textAlign = "left"; ctx.fillText(p.text, p.x, p.y - p.t / 40); ctx.globalAlpha = 1; }
    for (let i = pops.length - 1; i >= 0; i--) if (pops[i].t > 1400) pops.splice(i, 1);
    if (ban) { ban.t += dt; const a = ban.t < 400 ? ban.t / 400 : ban.t > 2600 ? Math.max(0, 1 - (ban.t - 2600) / 400) : 1; if (ban.t > 3000) ban = null; else { ctx.globalAlpha = a; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = `700 ${Math.round(W / 22)}px Merriweather, Georgia, serif`; ctx.fillText(ban.a, W / 2, H * 0.45); ctx.font = `${Math.round(W / 55)}px 'Source Sans 3', system-ui`; ctx.fillStyle = "#C9D1E0"; ctx.fillText(ban.b, W / 2, H * 0.45 + W / 28); ctx.globalAlpha = 1; } }
    if (wave && wave.pool.length > COLS * ROWS) { ctx.fillStyle = "#8B95A5"; ctx.font = "11px 'Source Sans 3', system-ui"; ctx.textAlign = "right"; ctx.fillText(`+${n(wave.pool.length - wave.next)} more behind this wave`, W - 10, gridY - 8); }
    requestAnimationFrame(tick);
  }

  layout(); addEventListener("resize", () => { layout(); for (const s of inv) s.fall = Math.min(s.fall, 0); });
  hud(); load(0); board(); await poll(); requestAnimationFrame(tick);
  setInterval(poll, 15000); setInterval(board, 60000);
  $("pWaveNext")?.addEventListener("click", () => load(waveIx + 1)); $("pWavePrev")?.addEventListener("click", () => load(waveIx - 1));
})();
