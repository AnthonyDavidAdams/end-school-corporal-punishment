// Loads Google News headlines through the site's cached proxy (news.php) into any <ul id="news" data-q="...">.
(async () => {
  const ul = document.getElementById("news"); if (!ul) return;
  try {
    const r = await fetch("/kids/news.php?q=" + encodeURIComponent(ul.dataset.q)); const j = await r.json();
    if (!j.items || !j.items.length) { ul.innerHTML = '<li class="meta">No recent coverage found.</li>'; return; }
    ul.innerHTML = j.items.slice(0, 8).map(i => `<li><a href="${i.link}" rel="noopener">${i.title}</a><span class="meta">${i.source ? i.source + " · " : ""}${i.date}</span></li>`).join("") + `<li class="meta">Via Google News; headlines are not verified facts. <a href="https://news.google.com/search?q=${encodeURIComponent(ul.dataset.q)}" rel="noopener">More</a></li>`;
  } catch (e) { ul.innerHTML = '<li class="meta">News is unavailable right now.</li>'; }
})();
