// The parent guide "After a paddling": one markdown source (kit/after-a-paddling.md), three tables generated
// from data (data/states/<ST>.yaml and data/states/liability.json), one HTML body shared by the web page
// (tools/build-site.mjs, inside the site shell) and the print page / PDF (tools/kit/after-a-paddling.mjs).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

export const GUIDE = {
  slug: "after-a-paddling",
  title: "After a paddling: what a family can do",
  description: "What to do in the first forty-eight hours after a child is paddled at school, what your state's statute actually says, the five routes that work, the deadlines, and when a lawsuit is realistic. General information, not legal advice.",
};

export function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// Inline markdown: links, code, bold, italics. Text is escaped first, so the source cannot inject HTML.
export function inline(t) {
  return esc(t)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, b) => `<a href="${b}">${a}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(>])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

// Block markdown, the subset the guide uses: #/##/### headings, paragraphs, - and 1. lists (one level),
// > blockquotes, pipe tables, --- rules, and raw HTML blocks (a line starting with "<" passes through).
export function renderMd(md) {
  const out = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let i = 0;
  const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.+)$/))) { const h = m[1].length; out.push(`<h${h} id="${slug(m[2])}">${inline(m[2])}</h${h}>`); i++; continue; }
    if (/^---+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (line.startsWith("<")) { const buf = []; while (i < lines.length && lines[i].trim()) buf.push(lines[i++]); out.push(buf.join("\n")); continue; }
    if (line.startsWith(">")) { const buf = []; while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, "")); out.push(`<blockquote><p>${inline(buf.join(" "))}</p></blockquote>`); continue; }
    if (line.startsWith("|")) {
      const rows = []; while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const head = cells(rows[0]); const body = rows.slice(2).map(cells);
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^(-|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\./.test(line); const items = [];
      while (i < lines.length && (/^(-|\d+\.)\s/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^(-|\d+\.)\s/.test(lines[i])) items.push(lines[i].replace(/^(-|\d+\.)\s+/, "")); else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-|>]|\d+\.\s|<|---)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const ORDER = ["AL", "AR", "AZ", "FL", "GA", "IN", "KS", "KY", "LA", "MO", "MS", "NC", "OK", "SC", "TN", "TX", "WY"];

export function loadData(root) {
  const liability = JSON.parse(readFileSync(join(root, "data/states/liability.json"), "utf8"));
  const states = {};
  for (const f of readdirSync(join(root, "data/states")).filter((f) => f.endsWith(".yaml"))) {
    const d = YAML.parse(readFileSync(join(root, "data/states", f), "utf8"));
    states[d.code] = d;
  }
  return { liability, states };
}

const link = (text, url) => url ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text);

export function statesTable({ liability, states }) {
  const rows = ORDER.map((c) => {
    const s = states[c], l = liability.states[c];
    const statute = s.statute_url ? `<a href="${esc(s.statute_url)}">${esc(s.statute.replace(/\s*\(.*$/, ""))}</a>` : esc(s.statute);
    const limits = (s.limits || []).length ? (s.limits || []).map(esc).join("<br>") : "No conditions in the statute; the board policy sets them";
    return `<tr><td><b>${esc(s.name)}</b>${s.status === "partial" ? "<br><span class=\"note\">Legal, but every district has stopped by policy</span>" : ""}<br><span class="note">${statute}</span></td><td>${esc(l.consent_rule)}</td><td>${limits}</td><td>${l.immunity_quote ? `<q>${esc(l.immunity_quote)}</q> <span class="note">${link(l.immunity_cite, l.immunity_url)}</span>` : `<span class="note">${esc(l.immunity_none)}</span>`}</td></tr>`;
  });
  return `<table class="guide-table states"><thead><tr><th>State and statute</th><th>Consent rule in the statute</th><th>Limits in the statute</th><th>Immunity, in the statute's own words</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

export function deadlinesTable({ liability, states }) {
  const rows = ORDER.map((c) => {
    const s = states[c], l = liability.states[c];
    return `<tr><td><b>${esc(s.name)}</b></td><td>${esc(l.notice_of_claim)} <span class="note">${link(l.notice_cite, l.notice_url)}</span></td><td>${esc(l.limitation)} <span class="note">${link(l.limitation_cite, l.limitation_url)}</span></td><td>${esc(l.minor_tolling)}${l.tolling_cite ? ` <span class="note">${link(l.tolling_cite, l.tolling_url)}</span>` : ""}</td></tr>`;
  });
  return `<table class="guide-table deadlines"><thead><tr><th>State</th><th>Notice of claim before suing a district</th><th>Time limit to sue</th><th>Does the child's age pause the clock?</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

export function lawyersTable({ liability, states }) {
  const org = (o) => o ? `${link(o.name, o.url)}${o.phone ? `<br><span class="note">${esc(o.phone)}</span>` : ""}` : "<span class=\"note\">Not found</span>";
  const rows = ORDER.map((c) => {
    const s = states[c], l = liability.states[c];
    return `<tr><td><b>${esc(s.name)}</b></td><td>${org(l.bar_referral)}</td><td>${org(l.protection_advocacy)}</td><td>${org(l.legal_aid)}</td><td>${org(l.sea_complaint)}</td></tr>`;
  });
  return `<table class="guide-table lawyers"><thead><tr><th>State</th><th>Lawyer referral</th><th>Disability rights (free)</th><th>Legal aid</th><th>State education agency</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

// The guide's HTML body: the markdown with its three table tokens filled in.
export function guideBody(root) {
  const data = loadData(root);
  const md = readFileSync(join(root, "kit", `${GUIDE.slug}.md`), "utf8")
    .replace("{{states_table}}", statesTable(data))
    .replace("{{deadlines_table}}", deadlinesTable(data))
    .replace("{{lawyers_table}}", lawyersTable(data));
  return { ...GUIDE, body: renderMd(md), verified: data.liability.verified };
}
