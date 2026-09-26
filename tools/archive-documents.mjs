// Keep the originals, not just the text.
//
// cache-documents.mjs keeps the extracted text of every cited document, which is what a later query
// reads. This keeps the bytes as served -- the PDF itself, or the policy page as rendered -- so that
// when a district replaces its handbook next August at the same address, the document the quote came
// from still exists somewhere, in the form it was published. The archive lives outside git
// (data/documents/, hundreds of MB) and is published beside the site at /kids/documents/<state>/<id>.<ext>
// so any record can link "archived copy". A manifest carries the URL, the hash, the size, the type
// and the date, so a reader can tell exactly what was captured and when.
//
//   node tools/archive-documents.mjs [--workers 6] [--state FL] [--only-new]
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { ProxyAgent, fetch as ufetch } from "undici";
import { fetchWithBrowser, browserAvailable, closeBrowser } from "./tasb/browser.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = Number(arg("workers", 6));
const ONLY_STATE = arg("state", null);
const DIR = join(root, "data/documents");
const MF = join(DIR, "manifest.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 groundcrew/0.4 (+https://github.com/AnthonyDavidAdams/groundcrew)";
const PROXY = process.env.EGRESS_PROXIES?.split(",")[0]?.trim() || null;
const dispatcher = PROXY ? new ProxyAgent(PROXY) : null;
const CHALLENGE = /Client Challenge|Pardon Our Interruption|_Incapsula_|Just a moment|Enable JavaScript and cookies/i;

mkdirSync(DIR, { recursive: true });
const manifest = existsSync(MF) ? JSON.parse(readFileSync(MF, "utf8")) : {};

// Every distinct URL the record cites: the source of each district and every entry in its documents list.
const targets = new Map();
for (const f of readdirSync(join(root, "data/districts")).filter((f) => f.endsWith(".yaml"))) {
  const state = f.replace(".yaml", "");
  if (ONLY_STATE && state !== ONLY_STATE) continue;
  const d = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  const rows = Array.isArray(d) ? d : (d.districts || Object.values(d));
  for (const r of rows) {
    const slug = (r.nces_id && String(r.nces_id) !== "null") ? String(r.nces_id) : String(r.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const urls = [r.source, ...(r.documents || []).map((x) => x.url)].filter((u) => u && /^https?:\/\//.test(u));
    urls.forEach((u, i) => { if (!targets.has(u)) targets.set(u, { state, name: r.name, nces_id: r.nces_id ?? null, url: u, key: i === 0 ? slug : `${slug}-${i}` }); });
  }
}
const todo = [...targets.values()].filter((t) => !manifest[t.url]);
console.log(`${targets.size} distinct cited documents, ${todo.length} not yet archived`);

const extOf = (ct, url, bytes) => {
  if (bytes.slice(0, 5).toString() === "%PDF-") return "pdf";
  if (/pdf/i.test(ct)) return "pdf";
  if (/wordprocessingml|msword/i.test(ct) || /\.docx?(\?|$)/i.test(url)) return /docx/i.test(ct + url) ? "docx" : "doc";
  if (/text\/plain/i.test(ct)) return "txt";
  return "html";
};

async function get(url) {
  for (const [label, f, opts] of [["direct", fetch, {}], ...(dispatcher ? [["proxy", ufetch, { dispatcher }]] : [])]) {
    try {
      const r = await f(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(60_000), ...opts });
      if (!r.ok) continue;
      const ct = r.headers.get("content-type") || "";
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length < 1200 || (/html/i.test(ct) && CHALLENGE.test(bytes.toString("utf8", 0, 6000)))) continue;
      return { bytes, ct, via: label, final_url: r.url };
    } catch { /* next */ }
  }
  return null;
}

let cur = 0, ok = 0, failed = 0, bytesTotal = 0;
const useBrowser = await browserAvailable();
async function worker() {
  for (;;) {
    const t = todo[cur++]; if (!t) return;
    let got = await get(t.url);
    if (!got && useBrowser) {
      const b = await fetchWithBrowser(t.url).catch(() => null);
      if (b?.html && b.html.length > 1200 && !CHALLENGE.test(b.html)) got = { bytes: Buffer.from(b.html, "utf8"), ct: "text/html", via: "browser", final_url: b.url };
    }
    if (!got) { failed++; manifest[t.url] = { ...t, archived: null, error: "could not fetch", tried: new Date().toISOString().slice(0, 10) }; continue; }
    const ext = extOf(got.ct, got.final_url || t.url, got.bytes);
    const rel = `data/documents/${t.state}/${t.key}.${ext}`;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), got.bytes);
    bytesTotal += got.bytes.length; ok++;
    manifest[t.url] = { state: t.state, name: t.name, nces_id: t.nces_id, url: t.url, final_url: got.final_url, path: rel, public: `https://earthpilot.org/kids/documents/${t.state}/${t.key}.${ext}`,
      bytes: got.bytes.length, content_type: got.ct.split(";")[0], sha256: createHash("sha256").update(got.bytes).digest("hex"), via: got.via, archived: new Date().toISOString().slice(0, 10) };
    if ((ok + failed) % 50 === 0) { console.log(`  ${ok} archived, ${failed} failed, ${(bytesTotal / 1e6).toFixed(0)} MB`); writeFileSync(MF, JSON.stringify(manifest, null, 1)); }
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
await closeBrowser().catch(() => {});
writeFileSync(MF, JSON.stringify(manifest, null, 1));
const all = Object.values(manifest);
console.log(`\n${ok} archived this run (${(bytesTotal / 1e6).toFixed(0)} MB), ${failed} failed; manifest: ${all.filter((m) => m.archived).length} archived, ${all.filter((m) => !m.archived).length} unreachable`);
