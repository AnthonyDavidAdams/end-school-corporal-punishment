// The wall: every regular school district in every state where corporal punishment is still legal,
// as one brick each, with what the record knows about it. This is the record's shape made visible:
// 4,233 bricks, and the dark ones are the work. Compact keys, because a browser loads all of it.
//   i nces id · n name · s status (b bans, a allows, c consent, s silent, u unknown, - unseeded) · k students struck 2023-24 (federal)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const csv = (t) => { const [h, ...rows] = t.trim().split("\n"); const head = h.split(",").map((x) => x.trim()); const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; }; return rows.map((l) => Object.fromEntries(head.map((k, i) => [k, (parse(l)[i] ?? "").trim()]))); };
const states = JSON.parse(readFileSync(join(root, "site/data/states.json"), "utf8"));
const rec = JSON.parse(readFileSync(join(root, "site/data/districts.json"), "utf8"));
const dir = csv(readFileSync(join(root, "data/nces/lea-directory-2023-24.csv"), "utf8"));
const crdc = Object.fromEntries(csv(readFileSync(join(root, "data/crdc/2023-24/districts.csv"), "utf8")).map((r) => [r.nces_id, Number(r.students)]));
const S = { bans: "b", allows: "a", consent_required: "c", silent: "s", unknown: "u" };
const title = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bIsd\b/g, "ISD").replace(/\bCisd\b/g, "CISD").replace(/\bR-([ivx]+)\b/gi, (m, r) => `R-${r.toUpperCase()}`);
const out = { generated: new Date().toISOString().slice(0, 10), legend: { b: "board prohibits it", a: "board permits it", c: "permitted with parental consent", s: "documents read, no rule found", u: "on the record without a source", "-": "nobody has read its policy" }, states: [] };
let totals = { bricks: 0, placed: 0, children_behind_dark: 0 };
for (const [code, s] of Object.entries(states)) {
  if (!["legal", "partial"].includes(s.status)) continue;
  const byId = new Map(); for (const r of rec[code] ?? []) if (r.nces_id) byId.set(String(r.nces_id), r);
  const bricks = dir.filter((d) => d.state === code && d.lea_type.startsWith("Regular public")).map((d) => {
    const r = byId.get(d.nces_id);
    const k = crdc[d.nces_id] ?? r?.crdc_students_latest ?? 0;
    return { i: d.nces_id, n: title(d.name), s: r ? (S[r.status] ?? "u") : "-", k };
  });
  // Filled bricks first, so a column reads as a stack that fills from the floor; among the dark ones,
  // the districts that struck the most children come first, because they are the ones to pick up.
  const order = { b: 0, a: 1, c: 2, s: 3, u: 4, "-": 5 };
  bricks.sort((x, y) => order[x.s] - order[y.s] || y.k - x.k || x.n.localeCompare(y.n));
  const placed = bricks.filter((b) => b.s !== "-" && b.s !== "u").length;
  out.states.push({ code, name: s.name, status: s.status, total: bricks.length, placed, bricks });
  totals.bricks += bricks.length; totals.placed += placed; totals.children_behind_dark += bricks.filter((b) => b.s === "-" || b.s === "u").reduce((a, b) => a + b.k, 0);
}
out.states.sort((a, b) => (b.total - b.placed) - (a.total - a.placed));
out.totals = totals;
writeFileSync(join(root, "site/data/wall.json"), JSON.stringify(out));
console.log(`wall: ${out.states.length} states, ${totals.bricks} bricks, ${totals.placed} placed, ${totals.children_behind_dark} children behind dark bricks`);
