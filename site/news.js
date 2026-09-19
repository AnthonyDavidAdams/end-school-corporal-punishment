// Loads Google News headlines through the site's cached proxy (news.php) into any <ul id="news" data-q="...">.
// Bump when icon.php changes how it picks an icon, so visitors are not stuck with a cached result
// from the old logic for a week.
const ICON_V = 2;

(async () => {
  const ul = document.getElementById("news"); if (!ul) return;
  try {
    const r = await fetch("/kids/news.php?q=" + encodeURIComponent(ul.dataset.q)); const j = await r.json();
    if (!j.items || !j.items.length) { ul.innerHTML = '<li class="meta">No recent coverage found.</li>'; return; }
    const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    // The publisher's own mark, served from this site rather than fetched from a favicon service, so
    // reading a headline here does not tell a third party what you are reading. A publisher with no
    // usable icon falls back to their initial rather than a broken image.
    const thumb = i => {
      const letter = esc((i.source || i.domain || "?").trim().charAt(0).toUpperCase() || "?");
      return i.domain
        ? `<span class="nthumb" data-letter="${letter}"><img src="/kids/icon.php?d=${encodeURIComponent(i.domain)}&v=${ICON_V}" alt="" loading="lazy" decoding="async" width="28" height="28" onerror="this.remove()"></span>`
        : `<span class="nthumb" data-letter="${letter}"></span>`;
    };
    ul.innerHTML = j.items.slice(0, 8).map(i => `<li>${thumb(i)}<span class="nbody"><a href="${esc(i.link)}" rel="noopener">${esc(i.title)}</a><span class="meta">${i.source ? esc(i.source) + " · " : ""}${esc(i.date)}</span></span></li>`).join("") + `<li class="meta">Via Google News; headlines are not verified facts. <a href="https://news.google.com/search?q=${encodeURIComponent(ul.dataset.q)}" rel="noopener">More</a></li>`;
  } catch (e) { ul.innerHTML = '<li class="meta">News is unavailable right now.</li>'; }
})();
