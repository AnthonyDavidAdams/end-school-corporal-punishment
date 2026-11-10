// A second way to search, for the days the search API is out of credit.
//
// The nightly and the engine's "look again on their own site" step both ask Brave. On 2026-11-07 the
// prepaid balance ran out, Brave answered 402, and both stopped: correctly, because recording a refusal
// as "nothing found" marks a district as looked-at when nothing looked. But stopping meant the record
// stood still for days over a five-dollar balance.
//
// This relay runs the same queries through Claude Code's own web search (`claude -p`, the Max plan,
// never the API) and hands back plain results. The model is used as a pipe, not a judge: it may only
// repeat what the search tool returned. Everything downstream is unchanged, so a result is still ranked
// by the decision model and still has to be fetched and quoted before anything is recorded; a URL that
// does not exist fails at the fetch and never reaches the record.
//
//   node tools/lib/relay-search.mjs "query one" "query two"     # prints [[...results for one], [...two]]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL = process.env.ESCP_RELAY_MODEL || "claude-haiku-5-5";
const SYSTEM = `You are a search relay. Run each web search you are given with the WebSearch tool, exactly as written, one search per query. Then output one JSON array and nothing else: every result the tool returned, as {"q": <index of the query>, "title": "...", "url": "...", "snippet": "..."}. Copy titles and URLs exactly as the tool returned them. Never add a URL the tool did not return. If a search returns nothing, add nothing for it. If the search tool is unavailable or errors, output exactly: SEARCH_UNAVAILABLE`;

function bin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const local = join(process.env.HOME || "", ".local/bin/claude");
  return existsSync(local) ? local : "claude";
}

// Returns one array of {title, url, snippet} per query, in order. Throws when the relay itself did not
// work, so the caller can tell "searched, nothing there" from "could not search".
export function relaySearch(queries) {
  if (!queries.length) return [];
  const prompt = "Queries:\n" + queries.map((q, i) => `${i}: ${q}`).join("\n");
  const p = spawnSync(bin(), ["-p", "--model", MODEL, "--output-format", "text", "--no-session-persistence",
    "--allowedTools", "WebSearch", "--system-prompt", SYSTEM, prompt],
    { encoding: "utf8", timeout: 240_000, input: "", maxBuffer: 8 * 1024 * 1024 });
  if (p.error || p.status !== 0) throw new Error(`search relay failed: ${String(p.error?.message || p.stderr || p.status).slice(0, 160)}`);
  const out = p.stdout || "";
  if (/SEARCH_UNAVAILABLE/.test(out)) throw new Error("search relay: the web search tool was unavailable");
  const a = out.indexOf("["), b = out.lastIndexOf("]");
  if (a < 0 || b <= a) throw new Error(`search relay returned no list: ${out.slice(0, 120)}`);
  let rows;
  try { rows = JSON.parse(out.slice(a, b + 1)); } catch { throw new Error(`search relay returned unreadable JSON: ${out.slice(a, a + 120)}`); }
  const per = queries.map(() => []);
  for (const r of rows) {
    const i = Number(r?.q);
    if (!Number.isInteger(i) || !per[i] || typeof r.url !== "string" || !/^https?:\/\//.test(r.url)) continue;
    if (per[i].some((x) => x.url === r.url)) continue;
    per[i].push({ title: String(r.title || r.url).slice(0, 200), url: r.url, snippet: String(r.snippet || "").slice(0, 220) });
  }
  return per;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const qs = process.argv.slice(2);
  if (!qs.length) { console.error("usage: relay-search.mjs <query> [<query> ...]"); process.exit(1); }
  try { console.log(JSON.stringify(relaySearch(qs))); }
  catch (e) { console.error(e.message); process.exit(2); }
}
