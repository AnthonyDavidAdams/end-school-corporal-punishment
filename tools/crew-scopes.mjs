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

if (import.meta.url === `file://${process.argv[1]}`) {
  const scopes = scanScopes();
  const p = join(root, "crew/tasks/tasks.yaml");
  const yaml = readFileSync(p, "utf8");
  const line = `    scopes: [${scopes.map((s) => (/[:,]/.test(s) ? `"${s}"` : s)).join(", ")}]`;
  // Distinguish "the line is not there" from "the line is already right". The first is a broken
  // generator and has to stop; the second is the normal case on a re-run and must not.
  if (!/^ {4}scopes: \[[^\]]*\]$/m.test(yaml)) throw new Error("crew/tasks/tasks.yaml: no scopes line to replace on district-policy-scan");
  const next = yaml.replace(/^ {4}scopes: \[[^\]]*\]$/m, line);
  if (next !== yaml) writeFileSync(p, next);
  console.log(`${scopes.length} scopes across ${new Set(scopes.map((s) => s.split(":")[0])).size} states; first six: ${scopes.slice(0, 6).join(" | ")}`);
}
