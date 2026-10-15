// The Behavior Coach page. The conversation lives in this tab's memory only: nothing is written to
// localStorage, nothing is sent anywhere but /kids/coach/api.php, and closing the tab erases it.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var form = $("#intake"), chat = $("#chat"), log = $("#log"), composer = $("#composer"), box = $("#say"), send = $("#send");
  var messages = [], busy = false, started = false;

  // Chips: a button group that writes to a hidden field. Single or multi.
  document.querySelectorAll(".chips").forEach(function (g) {
    var multi = g.hasAttribute("data-multi"), hidden = g.querySelector("input[type=hidden]");
    g.querySelectorAll("button").forEach(function (b) {
      b.type = "button";
      b.addEventListener("click", function () {
        if (multi) { b.classList.toggle("on"); }
        else { g.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on"); }
        hidden.value = Array.prototype.map.call(g.querySelectorAll("button.on"), function (x) { return x.textContent.trim(); }).join(", ");
        if (hidden.name === "role") document.body.setAttribute("data-role", b.getAttribute("data-v") || "");
        g.classList.remove("missing");
      });
    });
  });

  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // Enough markdown for a coach: paragraphs, numbered and bulleted lists, bold, links to the few hosts the coach may name.
  function md(t) {
    var out = [], list = null;
    t.split(/\n/).forEach(function (line) {
      var m = line.match(/^\s*(\d+)[.)]\s+(.*)/), u = line.match(/^\s*[-*•]\s+(.*)/);
      if (m || u) {
        var kind = m ? "ol" : "ul";
        if (list !== kind) { if (list) out.push("</" + list + ">"); out.push("<" + kind + ">"); list = kind; }
        out.push("<li>" + inline(m ? m[2] : u[1]) + "</li>");
      } else {
        if (list) { out.push("</" + list + ">"); list = null; }
        if (line.trim()) out.push("<p>" + inline(line) + "</p>");
      }
    });
    if (list) out.push("</" + list + ">");
    return out.join("");
  }
  function inline(s) {
    s = esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^#+\s*/, "");
    return s.replace(/\b((?:https?:\/\/)?(?:earthpilot\.org|pbis\.org|ies\.ed\.gov|www\.ed\.gov|ed\.gov|healthychildren\.org)[^\s<)]*)/g, function (u) {
      var href = /^https?:/.test(u) ? u : "https://" + u; return '<a href="' + href + '" rel="noopener" target="_blank">' + u + "</a>";
    });
  }
  function add(role, text) {
    var d = document.createElement("div"); d.className = "cmsg " + role;
    d.innerHTML = role === "bot" ? md(text) : "<p>" + esc(text).replace(/\n/g, "<br>") + "</p>";
    log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
  }
  function track(name) {
    try { if (window.fbq && !window.__escpNoAds) fbq("trackCustom", name); if (window.gtag) gtag("event", name.toLowerCase()); if (window.lintrk && !window.__escpNoAds) lintrk("track", { conversion_id: name.toLowerCase() }); } catch (e) {}
  }

  function ask(text) {
    if (busy) return;
    messages.push({ role: "user", content: text });
    add("you", text); busy = true; send.disabled = true;
    var w = add("bot wait", "Thinking it through.");
    fetch("/kids/coach/api.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: messages }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        w.remove();
        if (!x.ok || !x.j.text) { add("bot err", x.j.error || "The coach did not answer. Try once more."); messages.pop(); return; }
        messages.push({ role: "assistant", content: x.j.text }); add("bot", x.j.text); track("CoachReply");
      })
      .catch(function () { w.remove(); add("bot err", "The coach did not answer. Try once more."); messages.pop(); })
      .then(function () { busy = false; send.disabled = false; box.focus({ preventScroll: true }); if (messages.length >= 28) { composer.classList.add("done"); add("bot", "That is the end of this conversation. Press Start over to begin another."); } });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = new FormData(form), need = ["role", "grade", "setting", "behavior", "freq"], ok = true;
    need.forEach(function (n) { if (!f.get(n)) { ok = false; $('[name="' + n + '"]', form).closest(".chips").classList.add("missing"); } });
    if (!ok) { $(".missing", form).scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    var role = f.get("role"), parts = ["I am " + (/^a/i.test(role) ? "an " : "a ") + role.toLowerCase() + "."];
    parts.push("The child is in " + f.get("grade") + ".");
    parts.push("It happens " + f.get("setting").toLowerCase() + ".");
    parts.push("What is happening: " + f.get("behavior").toLowerCase() + ".");
    parts.push("How often: " + f.get("freq").toLowerCase() + ".");
    if (f.get("tried")) parts.push("Already tried: " + f.get("tried").toLowerCase() + ".");
    if (f.get("home")) parts.push("Recent changes at home: " + f.get("home").toLowerCase() + ".");
    if (f.get("when")) parts.push("When it tends to happen: " + f.get("when").toLowerCase() + ".");
    var d = (f.get("describe") || "").trim(); if (d) parts.push("The last time it happened: " + d);
    document.body.classList.add("chatting"); started = true; track("CoachStart");
    ask(parts.join(" "));
  });

  composer.addEventListener("submit", function (e) { e.preventDefault(); var t = box.value.trim(); if (!t || busy) return; box.value = ""; box.style.height = ""; ask(t); });
  box.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); } });
  box.addEventListener("input", function () { box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight, 160) + "px"; });
  $("#restart").addEventListener("click", function () { messages = []; log.innerHTML = ""; composer.classList.remove("done"); document.body.classList.remove("chatting"); form.reset(); document.querySelectorAll(".chips button").forEach(function (b) { b.classList.remove("on"); }); document.querySelectorAll(".chips input[type=hidden]").forEach(function (h) { h.value = ""; }); window.scrollTo(0, 0); });
  $("#print").addEventListener("click", function () { window.print(); });
  window.addEventListener("beforeunload", function () { messages = []; });
})();
