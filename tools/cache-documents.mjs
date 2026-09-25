// Keep the documents, not just their addresses.
//
// Every record cites a URL, and a school district's handbook is replaced each August at the same
// address. Within a year a good share of these links will serve a different document or none, and the
// quote in the record becomes a claim nobody can check -- which is the one thing this project cannot
// afford, since the verbatim quote is the whole basis of it.
//
// It is also what makes the corpus queryable. The corporal punishment question needed one sentence
// from each document; the phone policy, AI policy, restraint and dress code questions need the same
// documents and nobody has to fetch them again.
//
// Extracted text rather than the original PDF: it is a tenth of the size, it is what any later query
// reads, and the original remains at its URL with a Wayback capture beside it. Gzipped, because a
// hundred thousand characters of policy prose compresses to about a fifth.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = "https://escp-mcp-production.up.railway.app/mcp";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = Number(arg("workers", 5));
const DIR = join(root, "data/policies");

async function mcp(name, args) {
  try {
    const res = await fetch(SERVER, { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      signal: AbortSignal.timeout(180_000) });
    const line = (await res.text()).split("\n").find((l) => l.startsWith("data: "));
    if (!line) return null;
    const r = JSON.parse(line.slice(6)).result;
    return { error: !!r.isError, text: r.content[0].text };
  } catch (err) { return { error: true, text: String(err.message || err) }; }
}

// Every district that carries a source, with enough identity to name a file.
const targets = [];
for (const f of readdirSync(join(root, "data/districts")).filter((f) => f.endsWith(".yaml"))) {
  const state = f.replace(".yaml", "");
  const text = readFileSync(join(root, "data/districts", f), "utf8");
  for (const block of text.split("\n  - name: ").slice(1)) {
    const name = block.split("\n")[0].trim();
    const g = (k) => (block.match(new RegExp(`^    ${k}: (.+)$`, "m")) || [, null])[1]?.trim().replace(/^["']|["']$/g, "");
    const source = g("source");
    if (!source || source === "null") continue;
    const nces = g("nces_id");
    const slug = (nces && nces !== "null") ? nces : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    targets.push({ state, name, source, path: `data/policies/${state}/${slug}.txt.gz` });
  }
}
console.log(`${targets.length} districts carry a source`);
const todo = targets.filter((t) => !existsSync(join(root, t.path)));
console.log(`${todo.length} not yet cached`);

let cur = 0, ok = 0, failed = 0, bytes = 0;
const manifest = [];
async function worker() {
  for (;;) {
    const t = todo[cur++]; if (!t) return;
    const got = await mcp("fetch_document", { url: t.source, terms: ["corporal punishment"], context_words: 20 });
    if (!got || got.error) { failed++; continue; }
    let j; try { j = JSON.parse(got.text); } catch { failed++; continue; }
    // The tool returns hit windows rather than the body, so ask for the pages themselves.
    const full = await mcp("fetch_document", { url: t.source, pages: `1-${Math.min(j.page_count || 1, 400)}` });
    let body = "";
    if (full && !full.error) { try { const fj = JSON.parse(full.text); body = fj.text || (Array.isArray(fj.pages) ? fj.pages.join("\n") : ""); } catch { body = ""; } }
    if (!body || body.length < 500) { failed++; continue; }
    mkdirSync(dirname(join(root, t.path)), { recursive: true });
    const gz = gzipSync(Buffer.from(body, "utf8"));
    writeFileSync(join(root, t.path), gz);
    bytes += gz.length; ok++;
    manifest.push({ state: t.state, name: t.name, source: t.source, path: t.path,
      chars: body.length, sha256: createHash("sha256").update(body).digest("hex"), cached: new Date().toISOString().slice(0, 10) });
    if (ok % 25 === 0) console.log(`  ${ok} cached, ${failed} failed, ${(bytes / 1e6).toFixed(1)} MB`);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));

const mf = join(root, "data/policies/manifest.json");
const prev = existsSync(mf) ? JSON.parse(readFileSync(mf, "utf8")) : [];
const merged = [...prev.filter((p) => !manifest.find((m) => m.path === p.path)), ...manifest].sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(mf, JSON.stringify(merged, null, 1) + "\n");
console.log(`\n${ok} cached (${(bytes / 1e6).toFixed(1)} MB gzipped), ${failed} could not be read; manifest has ${merged.length}`);
