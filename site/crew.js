// The crew roster, read live from the crew server so a new contributor appears without a rebuild.
(async () => {
  const host = document.getElementById("crewroster");
  if (!host) return;
  const SERVER = "https://escp-mcp-production.up.railway.app";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let d;
  try { d = await (await fetch(`${SERVER}/crew.json`)).json(); }
  catch { host.innerHTML = '<p class="meta">The crew server is not reachable right now.</p>'; return; }
  const total = d.contributors_total ?? 0;
  if (!d.members || !d.members.length) {
    host.innerHTML = `<p class="meta">${total ? `${total} contributor${total === 1 ? " has" : "s have"} had findings approved; none has claimed a badge yet.` : "No approved findings yet."} Be the first: ask your agent to call <code>claim_badge</code>.</p>`;
    return;
  }
  const dist = d.members.reduce((a, m) => a + (m.districts || 0), 0);
  host.innerHTML =
    `<p>${d.members.length} of ${total} contributor${total === 1 ? "" : "s"} have claimed a badge, between them ${dist.toLocaleString()} district${dist === 1 ? "" : "s"} on the record.</p>` +
    `<div class="roster">` + d.members.map(m => `<figure>
      <a href="${SERVER}${esc(m.badge)}"><img src="${SERVER}${esc(m.badge)}" alt="${esc(m.display_name || `contributor ${m.id}`)}: ${m.districts} districts recorded" loading="lazy" width="300" height="300"></a>
      <figcaption>${esc(m.display_name || `contributor ${m.id}`)}<br><span class="tier">${esc(m.tier || "Contributor")}</span></figcaption>
    </figure>`).join("") + `</div>`;
})();
