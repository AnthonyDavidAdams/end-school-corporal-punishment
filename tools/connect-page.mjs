// The "connect your agent" page, built from mcp/README.md.
//
// The instructions for every client already existed and lived in the README, one GitHub link off the
// contribute page. That is fine for someone reading the repository and useless for a room being told
// a URL out loud, which is how people actually arrive. So the section is rendered onto the site, from
// the same source, rather than retyped: two copies of a connection procedure drift, and the copy that
// drifts is always the one in front of the newcomer.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Only the clients section, and only down to the next h2, so the rest of the README stays a README.
export function connectSections() {
  const md = readFileSync(join(root, "mcp/README.md"), "utf8");
  const from = md.indexOf("## Connecting clients");
  if (from < 0) throw new Error("mcp/README.md no longer has a 'Connecting clients' section");
  const rest = md.slice(from + 1);
  const to = rest.indexOf("\n## ");
  const block = to < 0 ? rest : rest.slice(0, to);

  // Split on client headings; everything before the first one is the preamble.
  const parts = block.split(/\n### /);
  const preamble = parts.shift().replace(/^# Connecting clients\n/, "");
  const sections = parts.map((p) => {
    const nl = p.indexOf("\n");
    return { title: p.slice(0, nl).trim(), body: p.slice(nl + 1) };
  // "Running it yourself" is for someone hosting their own copy, not someone joining ours.
  }).filter((s) => !/^Running it yourself$/i.test(s.title));
  return { preamble, sections };
}

// A deliberately small Markdown subset: fenced code, paragraphs, ordered and unordered lists, bold,
// inline code and links. The README is written by hand and stays inside it; anything else renders as
// plain text rather than silently disappearing.
export function mdToHtml(md) {
  const out = [];
  const inline = (t) => esc(t)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, a, b) => `<a href="${esc(b)}" rel="noopener">${a}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*]+)\*/g, "$1<i>$2</i>");

  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      // Every code block on this page is something to copy, so each gets a button rather than asking
      // people to select text in a browser while a meeting waits.
      out.push(`<div class="copywrap"><pre class="cmd" data-lang="${esc(lang)}"><code>${esc(code.join("\n"))}</code></pre><button class="copybtn" type="button">Copy</button></div>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      let fenced = false;
      while (i < lines.length && (/^\d+\.\s/.test(lines[i]) || /^\s{3,}\S/.test(lines[i]) || fenced || (items.length && lines[i].trim() === ""))) {
        const t = lines[i].trim();
        // A fenced block indented under a step. The content is a single line -- a URL, a command --
        // so it belongs inline in the step rather than as a block that breaks the numbering. Without
        // this the fence markers survived into the text and the step read "paste the URL: `` ... ``".
        if (t.startsWith("```")) { fenced = !fenced; i++; continue; }
        if (/^\d+\.\s/.test(lines[i]) && !fenced) items.push(lines[i].replace(/^\d+\.\s/, ""));
        else if (items.length && t) items[items.length - 1] += (fenced ? " `" + t + "`" : " " + t);
        i++;
      }
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      continue;
    }
    if (/^-\s/.test(line)) {
      const items = [];
      while (i < lines.length && (/^-\s/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^-\s/.test(lines[i])) items.push(lines[i].replace(/^-\s/, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("```") && !/^[-\d]/.test(lines[i])) { para.push(lines[i]); i++; }
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}
