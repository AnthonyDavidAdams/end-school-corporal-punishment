// Sends the assembled outbox. Refuses to do anything without --confirm, refuses to send twice to the
// same district, and paces itself.
//
// Usage: node tools/outreach/send.mjs [--state XX] [--limit N] [--dry-run | --confirm]
// Needs RESEND_API_KEY and OUTREACH_FROM in the environment.
import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const confirm = argv.includes("--confirm");
const onlyState = arg("--state", null);
const limit = Number(arg("--limit", Infinity));
const PACE_MS = 2000;

const SENT = join(root, "outreach/sent.csv");
if (!existsSync(SENT)) writeFileSync(SENT, "sent_at,state,district,to,subject,provider_id\n");
// A district hears from us once. The ledger is the only thing standing between "one notice" and a
// cadence, so it is read from disk every run rather than held in the sender's head.
const already = new Set(readFileSync(SENT, "utf8").trim().split("\n").slice(1)
  .map(l => { const c = l.split(","); return `${c[1]}|${c[2]}`; }));

const queue = [];
const box = join(root, "outreach/outbox");
for (const st of existsSync(box) ? readdirSync(box) : []) {
  if (onlyState && st !== onlyState) continue;
  for (const f of readdirSync(join(box, st))) {
    const raw = readFileSync(join(box, st, f), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) { console.error(`skip ${st}/${f}: no front matter`); continue; }
    const meta = parse(m[1]);
    if (already.has(`${meta.state}|${meta.district}`)) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(meta.to || ""))) { console.error(`skip ${st}/${f}: address does not parse`); continue; }
    queue.push({ meta, body: m[2], path: `${st}/${f}` });
  }
}
const batch = queue.slice(0, limit);
console.log(`${queue.length} unsent, sending ${batch.length}`);
for (const q of batch) console.log(`  ${q.meta.state} ${q.meta.district} -> ${q.meta.to}`);

if (!confirm) { console.log(`\nDry run. Nothing was sent. Add --confirm to send.`); process.exit(0); }
const key = process.env.RESEND_API_KEY, from = process.env.OUTREACH_FROM;
if (!key || !from) { console.error(`\nRESEND_API_KEY and OUTREACH_FROM must be set. Nothing sent.`); process.exit(1); }

// Markdown in, plain text out: these go to school office inboxes and a plain message is likelier to be
// read and likelier to be delivered than an HTML one from a domain with no sending history.
const plain = s => s.replace(/^> /gm, "    ").replace(/\*\*(.+?)\*\*/g, "$1");

let ok = 0, failed = 0;
for (const q of batch) {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: q.meta.to, reply_to: q.meta.reply_to, subject: q.meta.subject, text: plain(q.body) })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    appendFileSync(SENT, `${new Date().toISOString()},${q.meta.state},"${q.meta.district}",${q.meta.to},"${q.meta.subject.replace(/"/g, "'")}",${j.id || ""}\n`);
    ok++;
  } catch (e) { console.error(`  FAILED ${q.meta.state} ${q.meta.district}: ${e.message}`); failed++; }
  await new Promise(r => setTimeout(r, PACE_MS));
}
console.log(`\nsent ${ok}, failed ${failed}`);
