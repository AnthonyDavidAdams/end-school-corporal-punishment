// The live feed on the front page: what contributors' agents have done lately.
//
// Everything here comes from the Ground Crew server's public /activity.json, which publishes the work
// and not the worker: contributors appear as a six-character one-way hash, and no email, address or
// location is collected or shown. So the feed says what was read and where, which is the part a
// visitor should find persuasive anyway.

const SERVER = "https://escp-mcp-production.up.railway.app";
const POLL_MS = 45000;

const STATE_NAMES = {
  AL: "Alabama", AR: "Arkansas", AZ: "Arizona", FL: "Florida", GA: "Georgia", ID: "Idaho", IN: "Indiana",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", MS: "Mississippi", MO: "Missouri", NC: "North Carolina",
  OK: "Oklahoma", SC: "South Carolina", TN: "Tennessee", TX: "Texas", WY: "Wyoming", CO: "Colorado", NM: "New Mexico",
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const stateName = (code) => STATE_NAMES[code] ?? code;

// The agent string is whatever the contributor set. Show the model, not the plumbing.
function agentLabel(agent) {
  if (!agent) return "An agent";
  const s = String(agent);
  if (/fable/i.test(s)) return "A Claude Fable agent";
  if (/opus/i.test(s)) return "A Claude Opus agent";
  if (/sonnet/i.test(s)) return "A Claude Sonnet agent";
  if (/haiku/i.test(s)) return "A Claude Haiku agent";
  if (/claude/i.test(s)) return "A Claude agent";
  if (/gpt|openai/i.test(s)) return "A GPT agent";
  if (/gemini/i.test(s)) return "A Gemini agent";
  return "An agent";
}

function line(e) {
  const who = agentLabel(e.agent);
  const where = e.scope ? ` in ${esc(stateName(e.scope))}` : "";
  switch (e.kind) {
    case "verified": return `${who} had <strong>${esc(e.subject || "a district")}</strong> reviewed and added to the public record`;
    case "submitted": return `${who} read <strong>${esc(e.subject || "a district policy")}</strong>${where} and quoted it from the primary source`;
    case "claimed": return `${who} took on <strong>${esc(e.scope ? stateName(e.scope) : "a new state")}</strong>`;
    case "attempted": return `${who} looked at <strong>${esc(e.subject || "a district")}</strong>${where} — no readable primary source yet`;
    case "reported": return `${who} reported a problem with the tools${where}`;
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
  el.innerHTML = events.slice(0, 8).map((e) => `<li class="ev ev-${esc(e.kind)}"><span class="ev-when">${esc(e.ago || "")}</span><span class="ev-what">${line(e)}</span></li>`).join("");
}

// States touched in the last day get a ring on the map, so the picture is of work in progress rather
// than a finished dataset.
function markMap(events) {
  const svg = document.querySelector("#map svg");
  if (!svg) return false;
  const dayAgo = Date.now() - 86400000;
  const hot = new Set(events.filter((e) => Date.parse(e.at) > dayAgo).map((e) => e.scope).filter(Boolean));
  for (const p of svg.querySelectorAll("path.state")) p.classList.toggle("state-active", hot.has(p.dataset.state));
  const note = document.getElementById("live-map-note");
  if (note) {
    const names = [...hot].map(stateName);
    note.textContent = names.length
      ? `Outlined on the map: ${names.join(", ")} — worked on in the last 24 hours.`
      : "";
  }
  return true;
}

async function tick() {
  const stats = document.getElementById("live-stats");
  const feed = document.getElementById("live-feed");
  if (!stats || !feed) return;
  let data;
  try {
    const res = await fetch(`${SERVER}/activity.json?limit=60`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    if (!feed.dataset.loaded) feed.innerHTML = `<li class="meta">The live feed is unreachable right now. The <a href="/kids/contribute/">work itself</a> is unaffected.</li>`;
    return;
  }
  feed.dataset.loaded = "1";
  renderStats(stats, data.totals || {});
  renderFeed(feed, data.events || []);
  if (!markMap(data.events || [])) setTimeout(() => markMap(data.events || []), 1200);
  const live = document.getElementById("live-dot");
  if (live) { live.classList.remove("beat"); void live.offsetWidth; live.classList.add("beat"); }
}

if (document.getElementById("live-feed")) {
  tick();
  setInterval(tick, POLL_MS);
}
