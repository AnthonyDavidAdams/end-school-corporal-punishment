// The units the district scan is handed out in.
//
// The task used to declare one scope per state. That is the right size for one agent working for an
// evening and the wrong size for a room: Texas has 237 districts nobody has read, and the first
// person to say "Texas" locks the other nineteen out of it for four hours.
//
// So a state is cut into slices of ten districts, which is about an hour of one agent's time, and the
// slices are interleaved across states rather than listed state by state. The server hands out the
// first free unit in order, so interleaving means the tenth person to ask gets a different state from
// the first rather than the tenth slice of Texas, and the map lights up across the country while a
// room watches instead of in one corner of it.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PER_SLICE = 10;

export function scanScopes() {
  const wl = JSON.parse(readFileSync(join(root, "site/data/worklist.json"), "utf8"));
  // Biggest backlog first, so the states that need the most people are the ones with the most slices
  // waiting at the front of the rotation.
  const states = Object.entries(wl.by_state).sort((a, b) => b[1] - a[1]);

  const perState = states.map(([st, n]) => {
    const slices = Math.ceil(n / PER_SLICE);
    // A state small enough to be one sitting stays whole: "AZ" reads better than "AZ: districts 1-10"
    // when there is one district in it, and a scope is something a person says out loud.
    if (slices <= 1) return [st];
    return Array.from({ length: slices }, (_, i) => `${st}: districts ${i * PER_SLICE + 1}-${Math.min((i + 1) * PER_SLICE, n)}`);
  });

  // Round-robin across states.
  const out = [];
  for (let i = 0; out.length < perState.reduce((a, s) => a + s.length, 0); i++) {
    for (const s of perState) if (s[i]) out.push(s[i]);
  }
  return out;
}

// What the correspondence has run into that a person or a browsing agent can fix:
//   contact-capture        districts whose address bounced with nothing else on file, and districts with no address at all
//   recover-blocked-source districts that will hand over their policy only in person, or whose documents could not be read
export function correspondenceScopes() {
  let reqs = []; try { reqs = JSON.parse(readFileSync(join(root, "data/outreach/requests.json"), "utf8")); } catch {}
  const label = (r) => `${r.name}, ${r.state}`;
  const contacts = reqs.filter((r) => r.status === "bounced" && r.bounce_retry && r.state && r.name).map((r) => `${label(r)} (address bounced: find the superintendent's current office email)`);
  const pickups = reqs.filter((r) => /pickup/i.test(r.notes || "") && r.state && r.name).map((r) => `${label(r)} (policy offered only by in-person pickup: find it published elsewhere, or a person nearby)`);
  return { contacts: [...new Set(contacts)], pickups: [...new Set(pickups)] };
}

function replaceScopes(yaml, taskId, scopes, keep = []) {
  // the scopes line that belongs to this task: the first "    scopes: [...]" after "  - id: <taskId>"
  const start = yaml.indexOf(`  - id: ${taskId}`); if (start < 0) throw new Error(`no task ${taskId}`);
  const rest = yaml.slice(start); const m = rest.match(/^ {4}scopes: \[[^\]]*\]$/m); if (!m) throw new Error(`no scopes line on ${taskId}`);
  const all = [...keep, ...scopes];
  const line = `    scopes: [${all.map((s) => (/[:,()]/.test(s) ? `"${s.replace(/"/g, "'")}"` : s)).join(", ")}]`;
  return yaml.slice(0, start) + rest.replace(m[0], line);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const scopes = scanScopes();
  const p = join(root, "crew/tasks/tasks.yaml");
  let yaml = readFileSync(p, "utf8");
  yaml = replaceScopes(yaml, "district-policy-scan", scopes);
  const c = correspondenceScopes();
  yaml = replaceScopes(yaml, "contact-capture", c.contacts, ["AL", "AR", "FL", "GA", "MO", "MS", "OK", "TN", "TX"]);
  // recover-blocked-source keeps its hand-listed scopes and gains the pickup-only districts
  const rb = yaml.slice(yaml.indexOf("  - id: recover-blocked-source")).match(/^ {4}scopes: \[([^\]]*)\]$/m);
  const existing = rb ? rb[1].split(/,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim().replace(/^"|"$/g, "")).filter(Boolean).filter((x) => !/pickup/i.test(x)) : [];
  yaml = replaceScopes(yaml, "recover-blocked-source", c.pickups, existing);
  writeFileSync(p, yaml);
  console.log(`${scopes.length} scan scopes across ${new Set(scopes.map((s) => s.split(":")[0])).size} states; ${c.contacts.length} bounced addresses to find; ${c.pickups.length} pickup-only districts; first six: ${scopes.slice(0, 6).join(" | ")}`);
}
