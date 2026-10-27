// Smoke test for the crew as the Dockerfile assembles it: builds the same /crew layout in a temp directory,
// starts the Ground Crew engine on it over HTTP, and walks the two generated tasks end to end
// (list_tasks, claim_task, get_worklist, submit_finding). No network beyond localhost: the findings
// submitted carry no quote, so the engine's source check is skipped.
//
//   node crew/test.mjs                      # engine from GROUNDCREW_DIR, ~/groundcrew, or node_modules/@earthpilot/groundcrew
//   GROUNDCREW_DIR=/path/to/groundcrew node crew/test.mjs
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const engine = [process.env.GROUNDCREW_DIR, join(homedir(), "groundcrew"), join(root, "node_modules/@earthpilot/groundcrew")].filter(Boolean).find((p) => existsSync(join(p, "bin/groundcrew.mjs")));
if (!engine) { console.log("skip - no Ground Crew engine found (set GROUNDCREW_DIR)"); process.exit(0); }

// The crew directory, exactly as crew/Dockerfile lays it out.
const work = mkdtempSync(join(tmpdir(), "escp-crew-"));
const crew = join(work, "crew");
const copies = [
  ["crew/crew.json", "crew.json"], ["crew/values.md", "values.md"], ["crew/tasks", "tasks"], ["crew/schemas", "schemas"],
  ["crew/tools.mjs", "tools.mjs"], ["crew/units.mjs", "units.mjs"], ["tasks/README.md", "tasks/README.md"], ["facts", "facts"],
  ["AGENTS.md", "AGENTS.md"], ["CODE_OF_CONDUCT.md", "CODE_OF_CONDUCT.md"], ["templates", "templates"], ["skills", "skills"],
  ["data/schema", "data/schema"], ["data/states", "data/states"], ["data/districts", "data/districts"], ["data/crdc", "data/crdc"],
  ["site/data/worklist.json", "data/worklist.json"], ["data/handbooks/residue.json", "data/residue.json"],
  ["data/game/score.json", "game/score.json"], ["data/game/next-targets.json", "game/next-targets.json"],
  ["data/nces/lea-enrollment-2023-24.csv", "data/nces/lea-enrollment-2023-24.csv"],
];
for (const [from, to] of copies) {
  const src = join(root, from);
  if (!existsSync(src)) { console.log(`skip copy ${from} (absent)`); continue; }
  mkdirSync(dirname(join(crew, to)), { recursive: true });
  cpSync(src, join(crew, to), { recursive: true, dereference: true });
}
mkdirSync(join(work, "state"), { recursive: true });

// The assembled layout must satisfy the engine's own validator (task schema, schema and skill paths).
{
  // Only the task declarations are asserted on: data/states/ also holds agencies, governors and the like,
  // which are not state records and have failed the record schema since before this test existed.
  const v = spawnSync(process.execPath, [join(engine, "bin/groundcrew.mjs"), "validate", crew], { encoding: "utf8" });
  const out = `${v.stdout}\n${v.stderr}`;
  const taskFailures = out.split("\n").filter((l) => /^\s*FAIL (tasks\/|schemas\/|crew\.json)/.test(l));
  if (taskFailures.length) { console.error(out); rmSync(work, { recursive: true, force: true }); throw new Error(`groundcrew validate: ${taskFailures.join("; ")}`); }
  console.log(`ok - groundcrew validate: every task declaration passes (${(out.trim().split("\n").find((l) => /files checked/.test(l)) ?? "").trim()})`);
}

const port = 20000 + Math.floor(Math.random() * 20000);
const child = spawn(process.execPath, [join(engine, "bin/groundcrew.mjs"), "serve", crew, "--http", "--port", String(port), "--host", "127.0.0.1"], {
  env: { ...process.env, GROUNDCREW_STATE: join(work, "state/state.json"), GROUNDCREW_ISSUES_DIR: join(work, "state/issues"), GROUNDCREW_DOCS_DIR: join(work, "state/documents"), NODE_ENV: "test" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });
const base = `http://127.0.0.1:${port}`;
const cleanup = () => { try { child.kill(); } catch {} try { rmSync(work, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);

for (let i = 0; i < 100; i++) {
  try { const r = await fetch(`${base}/healthz`); if (r.ok) break; } catch {}
  if (child.exitCode !== null) { console.error(stderr); throw new Error("engine exited"); }
  await new Promise((r) => setTimeout(r, 200));
}

let id = 0;
async function call(name, args = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.text();
  const payload = res.headers.get("content-type")?.includes("text/event-stream")
    ? body.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5))).find((m) => m.id === id)
    : JSON.parse(body);
  if (payload.error) throw new Error(`${name}: ${JSON.stringify(payload.error)}`);
  const r = payload.result;
  const text = r.content?.[0]?.text ?? "";
  let json = null; try { json = JSON.parse(text); } catch {}
  return { isError: Boolean(r.isError), text, json };
}
const okJson = (r, what) => { assert.ok(!r.isError, `${what} failed: ${r.text.slice(0, 400)}`); assert.ok(r.json, `${what}: not JSON`); return r.json; };
let passed = 0;
const ok = (name) => { passed++; console.log(`ok - ${name}`); };
const today = new Date().toISOString().slice(0, 10);

try {
  const tasks = okJson(await call("list_tasks"), "list_tasks");
  // Over HTTP the crew's tools load on the first request, which is when the queues are generated.
  assert.match(stderr, /generated task units: record-completion \d+, neighbor-ask-research \d+/);
  ok("engine logged the generated unit counts");
  const rc = tasks.tasks.find((t) => t.id === "record-completion");
  const na = tasks.tasks.find((t) => t.id === "neighbor-ask-research");
  assert.ok(rc && na, "both generated tasks listed");
  assert.ok(rc.scopes.length > 600 && rc.open_scopes.length === rc.scopes.length, `record-completion has ${rc.scopes.length} scopes`);
  assert.ok(na.scopes.length > 200, `neighbor-ask-research has ${na.scopes.length} scopes`);
  assert.equal(new Set(rc.scopes).size, rc.scopes.length, "record-completion scopes unique");
  assert.equal(new Set(na.scopes).size, na.scopes.length, "neighbor-ask-research scopes unique");
  ok(`list_tasks: record-completion ${rc.scopes.length} units, neighbor-ask-research ${na.scopes.length} units`);

  // Ordering: the exposed states first, one district per state in turn, largest enrollment first.
  const score = JSON.parse(readFileSync(join(root, "data/game/score.json"), "utf8"));
  const exposure = score.permitting_states_by_exposure;
  const firstStates = rc.scopes.slice(0, 6).map((s) => s.slice(-2));
  assert.ok(firstStates.every((st) => exposure.includes(st)), `first scopes are in exposed states: ${firstStates.join(" ")}`);
  assert.ok(exposure.indexOf(firstStates[0]) <= exposure.indexOf(firstStates[1]), "exposure order respected at the front");
  ok(`record-completion order starts ${rc.scopes.slice(0, 3).join(" | ")}`);

  // claim_task by task: the first unit, with the district inline.
  const lease1 = okJson(await call("claim_task", { task: "record-completion", agent: "crew-test", human: "test@example.com" }), "claim_task record-completion");
  assert.equal(lease1.task, "record-completion");
  assert.equal(lease1.scope, rc.scopes[0]);
  assert.ok(lease1.units && lease1.units.ask && lease1.units.already_read && lease1.units.submit_as, "claim returns the unit inline");
  assert.ok(["silent", "unknown"].includes(lease1.units.record_status));
  ok(`claim_task record-completion -> ${lease1.scope} (${lease1.units.record_status}, enrollment ${lease1.units.enrollment})`);

  const wl1 = okJson(await call("get_worklist", { scope: lease1.scope, task: "record-completion" }), "get_worklist");
  assert.equal(wl1.scope, lease1.scope);
  assert.equal(wl1.task, "record-completion");
  ok("get_worklist resolves a record-completion scope");

  // A second claim gets the next unit, not the same one.
  const lease1b = okJson(await call("claim_task", { task: "record-completion", agent: "crew-test", human: "other@example.com" }), "second claim");
  assert.equal(lease1b.scope, rc.scopes[1]);
  ok("second claim gets the second unit");

  // A silent finding: source, no quote, so the source check is skipped and nothing is fetched.
  const u = lease1.units;
  const f1 = okJson(await call("submit_finding", { task: "record-completion", lease_id: lease1.id, record: { state: u.state, name: u.district, nces_id: u.nces_id, county: u.county, status: "silent", source: "https://example.org/board-policy-manual", quote: null, policy_code: null, last_verified: today, notes: "test: manual read, sections J and JD, no corporal punishment policy" } }), "submit silent finding");
  assert.equal(f1.status, "pending");
  assert.equal(f1.quote_check, "none");
  ok("submit_finding accepts a silent record-completion finding");

  const bad = await call("submit_finding", { task: "record-completion", lease_id: lease1.id, record: { state: u.state, name: u.district, status: "allows", last_verified: today } });
  assert.ok(bad.isError && /schema/i.test(bad.text), "allows without source+quote is refused");
  ok("submit_finding refuses allows without source and quote");

  // neighbor-ask-research
  const lease2 = okJson(await call("claim_task", { task: "neighbor-ask-research", agent: "crew-test", human: "test@example.com" }), "claim_task neighbor-ask-research");
  assert.equal(lease2.scope, na.scopes[0]);
  const v = lease2.units;
  assert.ok(v && v.neighbor_that_banned && v.neighbor_that_banned.name, "unit names the neighbor that banned");
  assert.ok(v.ask.includes("Do not write to anyone"));
  assert.equal(v.submit_as.record.kind, "contacts");
  ok(`claim_task neighbor-ask-research -> ${lease2.scope}; neighbor ${v.neighbor_that_banned.name}`);

  const wl2 = okJson(await call("get_worklist", { scope: lease2.scope }), "get_worklist without task");
  assert.equal(wl2.task, "neighbor-ask-research");
  ok("get_worklist finds a neighbor-ask-research scope without the task");

  const f2 = okJson(await call("submit_finding", { task: "neighbor-ask-research", lease_id: lease2.id, record: {
    kind: "contacts", state: v.state, name: v.district, nces_id: v.nces_id, as_of: today,
    superintendent: { name: "Test Person", email: "superintendent@example.org", source: "https://example.org/district/administration" },
    board_members: [{ name: "A. Member", role: "President", source: "https://example.org/board" }],
    next_board_meeting: { date: today, source: "https://example.org/board/meetings" },
    neighbor_ban: { name: v.neighbor_that_banned.name, nces_id: v.neighbor_that_banned.nces_id, source: null },
    notes: "test",
  } }), "submit contacts finding");
  assert.equal(f2.status, "pending");
  ok("submit_finding accepts a contacts finding");

  const bad2 = await call("submit_finding", { task: "neighbor-ask-research", lease_id: lease2.id, record: { state: v.state, name: v.district, as_of: today, superintendent: { name: null, email: null, source: null }, board_members: [], next_board_meeting: { date: null, source: null }, neighbor_ban: { name: null } } });
  assert.ok(bad2.isError && /schema/i.test(bad2.text), "a record without kind: contacts is refused");
  ok("submit_finding refuses a contacts record without its kind");

  // With a pending finding on it, the first unit is no longer handed out.
  await call("release_lease", { lease_id: lease1.id });
  const lease3 = okJson(await call("claim_task", { task: "record-completion", agent: "crew-test", human: "third@example.com" }), "third claim");
  assert.notEqual(lease3.scope, rc.scopes[0]);
  ok("a unit with a pending finding is not handed out again");

  // claim_task without a task still works and never hands out an undeclared unit.
  const any = okJson(await call("claim_task", { agent: "crew-test", human: "fourth@example.com" }), "claim_task unscoped");
  assert.ok(any.task && any.scope);
  ok(`claim_task with no task -> ${any.task}: ${any.scope}`);

  console.log(`\n${passed} passed`);
} catch (err) {
  console.error(`\nFAIL: ${err.message}`);
  console.error(stderr.slice(-2000));
  cleanup();
  process.exit(1);
}
cleanup();
