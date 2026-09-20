// Finds a district's published general email on the district's own website. Read-only unless --write.
//
// Only addresses the district itself puts on a public page are taken, and only ones that look like an
// office rather than a person: info@, superintendent@, contact@, the board clerk. A named individual's
// address is left alone even when it is published -- what this project needs is the front door, and
// writing to a person by name is a different thing with different rules (see crm/README.md).
//
// Usage: node tools/contact/harvest.mjs [--state XX] [--limit N] [--write]
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse, parseDocument } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const write = argv.includes("--write");
const onlyState = argv.includes("--state") ? argv[argv.indexOf("--state") + 1] : null;
const limit = Number(argv.includes("--limit") ? argv[argv.indexOf("--limit") + 1] : Infinity);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 groundcrew/0.7 (+https://github.com/AnthonyDavidAdams/groundcrew)";
const CACHE = join(root, ".cache/contact");
mkdirSync(CACHE, { recursive: true });
const PACE_MS = 1500;

// An office, not a person. "Superintendent" is included because in a small district that mailbox is
// the front door; a superintendent's own first-name address is not.
const OFFICE = /^(info|contact|webmaster|admin|administration|office|district|mainoffice|frontoffice|superintendent|supt|board|boardclerk|boe|centraloffice|central|reception|schools|help|inquiries)@/i;
const JUNK = /@(example|sentry|w3\.org|schemas|googlemail)|\.(png|jpg|gif|svg|css|js)$|^[a-f0-9]{16,}@/i;

async function get(url) {
  const k = join(CACHE, createHash("sha256").update(url).digest("hex").slice(0, 24) + ".html");
  if (existsSync(k)) return readFileSync(k, "utf8");
  const ctl = AbortSignal.timeout(20000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: ctl });
    const t = r.ok ? (await r.text()).slice(0, 2_000_000) : "";
    writeFileSync(k, t);
    await new Promise(r => setTimeout(r, PACE_MS));
    return t;
  } catch { writeFileSync(k, ""); return ""; }
}

// mailto: links first: an address the site links is one it intends people to use. Bare text addresses
// are taken only when no mailto exists, because a page can mention an address it is not offering.
function addresses(html) {
  const out = new Map();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) out.set(decodeURIComponent(m[1]).toLowerCase(), "mailto");
  if (!out.size) for (const m of html.matchAll(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) out.set(m[1].toLowerCase(), "text");
  return [...out].filter(([a]) => !JUNK.test(a));
}

const found = [], missing = [];
let n = 0;
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const p = join(root, "data/districts", f);
  let text = readFileSync(p, "utf8");
  const doc = parse(text);
  if (onlyState && doc.state !== onlyState) continue;
  const edits = [];
  for (const d of doc.districts) {
    if (!d.source || d.contact?.district_email) continue;
    const site = d.contact?.website;
    if (!site) { missing.push(`${doc.state} ${d.name}: no website on file`); continue; }
    if (n++ >= limit) break;
    const base = site.replace(/\/+$/, "");
    const host = (() => { try { return new URL(base).hostname.replace(/^www\./, ""); } catch { return null; } })();
    let picked = null, from = null;
    for (const path of ["", "/contact", "/contact-us", "/about/contact", "/district/contact"]) {
      const html = await get(base + path);
      if (!html) continue;
      const cands = addresses(html)
        // The district's own domain, so a vendor's support address in the page furniture is not
        // mistaken for the district's front door.
        .filter(([a]) => !host || a.endsWith("@" + host) || a.endsWith("." + host))
        .sort((a, b) => (OFFICE.test(b[0]) - OFFICE.test(a[0])) || (b[1] === "mailto") - (a[1] === "mailto"));
      const office = cands.find(([a]) => OFFICE.test(a));
      if (office) { picked = office[0]; from = base + path; break; }
    }
    if (picked) { found.push(`${doc.state} ${d.name}: ${picked}`); edits.push({ d, email: picked, from }); }
    else missing.push(`${doc.state} ${d.name}: nothing published at ${base}`);
  }
  if (write && edits.length) {
    // Spliced at parser offsets, never re-serialised. See tools/nces/backfill.mjs for why.
    const docNode = parseDocument(text);
    const items = docNode.get("districts").items;
    const splices = [];
    for (const { d, email, from } of edits) {
      const item = items.find(it => it.get("name") === d.name);
      const contact = item?.get("contact", true);
      if (!contact?.range) continue;
      splices.push({ at: contact.range[2], text: `      district_email: "${email}"\n      contact_page: ${from}\n` });
    }
    splices.sort((a, b) => b.at - a.at);
    for (const s of splices) text = text.slice(0, s.at) + s.text + text.slice(s.at);
    writeFileSync(p, text);
  }
}
console.log(`${found.length} addresses found, ${missing.length} not`);
for (const x of found) console.log(`  ${x}`);
if (missing.length) { console.log(`\nno address:`); for (const x of missing.slice(0, 30)) console.log(`  ${x}`); if (missing.length > 30) console.log(`  ... and ${missing.length - 30} more`); }
