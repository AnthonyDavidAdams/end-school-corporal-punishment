// The generated task queues: units of work computed from the record at server start, not written by hand.
//
// Two tasks hand out one district at a time from lists that only the data can produce:
//
//   record-completion       every district whose record status is `silent` (its handbook and other documents
//                           were read and say nothing) or `unknown` (nothing readable was found). The ask is
//                           the board policy manual's own sentence, which the Mothership's handbook search
//                           cannot reach. Ordered so the first claims land on the biggest districts in the
//                           states where the most children are exposed.
//   neighbor-ask-research   every district in data/game/next-targets.json: a permitting district in the same
//                           or an adjacent county as one that moved to a ban. The ask is who to write to and
//                           when the board meets, with sources. Nothing is sent by this task.
//
// Everything here reads from what the engine already parsed (crew.collections.districts) plus three files the
// Dockerfile copies beside the crew: game/score.json, game/next-targets.json and data/nces/lea-enrollment-2023-24.csv.
// When the crew directory is the repository's crew/ the same files are found one level up.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const RECORD_COMPLETION = "record-completion";
export const NEIGHBOR_ASK = "neighbor-ask-research";

const firstExisting = (paths) => paths.find((p) => existsSync(p)) ?? null;

function readJson(paths) {
  const p = firstExisting(paths);
  if (!p) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// Where a data file may be, in order: beside the crew (Docker layout), under the crew's data/, or in the
// repository the crew directory sits in.
function candidates(crewDir, rel) {
  return [join(crewDir, rel), join(crewDir, "data", rel), join(crewDir, "..", "data", rel)];
}

export function loadEnrollment(crewDir) {
  const map = new Map();
  const p = firstExisting([...candidates(crewDir, "nces/lea-enrollment-2023-24.csv"), join(crewDir, "data/nces/lea-enrollment-2023-24.csv")]);
  if (!p) return map;
  for (const line of readFileSync(p, "utf8").split("\n").slice(1)) {
    const [id, , n] = line.trim().split(",");
    if (id && n !== undefined && n !== "") map.set(id, Number(n));
  }
  return map;
}

export function loadGame(crewDir) {
  return {
    score: readJson([...candidates(crewDir, "game/score.json"), join(crewDir, "game/score.json")]),
    targets: readJson([...candidates(crewDir, "game/next-targets.json"), join(crewDir, "game/next-targets.json")]),
    enrollment: loadEnrollment(crewDir),
  };
}

// Every district entry in the record, with the state it belongs to. The engine parsed data/districts/<ST>.yaml
// into crew.collections.districts[ST] = { state, districts: [...] }.
export function allDistricts(crew) {
  const out = [];
  for (const [id, doc] of Object.entries(crew?.collections?.districts ?? {})) {
    if (!doc || !Array.isArray(doc.districts)) continue;
    const state = String(doc.state ?? id).toUpperCase();
    for (const d of doc.districts) if (d && d.name) out.push({ ...d, state });
  }
  return out;
}

const scopeOf = (d) => `${d.name}, ${d.state}`;
const isNces = (id) => /^\d{7}$/.test(String(id ?? ""));

// A district's website, as the record knows it: the contact block, or the host of a document already read
// when that host is the district's own rather than a document store or a policy portal.
const VENDOR_HOST = /s3|amazonaws|google\.com|edl\.io|finalsite|thrillshare|parentsquare|myconnectsuite|boardbook|eboardsolutions|simbli|boarddocs|diligent|tasb\.org|policyconnect|msbapolicy|archive\.org|dropbox|box\.com|sharepoint|onedrive/i;
function websiteOf(d) {
  if (d.contact?.website) return d.contact.website;
  const urls = [d.source, ...(d.documents ?? []).map((x) => x?.url)].filter(Boolean);
  for (const url of urls) {
    try { const u = new URL(url); if (!VENDOR_HOST.test(u.host)) return `${u.protocol}//${u.host}`; } catch { /* not a URL */ }
  }
  return null;
}

// Interleave lists one element at a time: the first element of each, then the second of each, and so on.
function roundRobin(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

// ---------------------------------------------------------------- record-completion
export function recordCompletionUnits(crew, game) {
  const exposure = (game?.score?.permitting_states_by_exposure ?? []).map((s) => String(s).toUpperCase());
  const enrollment = game?.enrollment ?? new Map();
  const byState = new Map();
  for (const d of allDistricts(crew)) {
    if (d.status !== "silent" && d.status !== "unknown") continue;
    const enr = Number.isFinite(d.enrollment) ? d.enrollment : (isNces(d.nces_id) ? enrollment.get(String(d.nces_id)) ?? null : null);
    const unit = {
      task: RECORD_COMPLETION,
      scope: scopeOf(d),
      district: d.name,
      state: d.state,
      county: d.county ?? null,
      nces_id: isNces(d.nces_id) ? String(d.nces_id) : null,
      enrollment: enr,
      students_struck_latest: d.crdc_students_latest ?? null,
      record_status: d.status,
      website: websiteOf(d),
      already_read: {
        what_the_record_says: d.status === "silent"
          ? "The documents below were read in full and contain no rule on corporal punishment. That is why the record is silent: the rule, if there is one, is in the board policy manual."
          : "No readable policy document was found. The notes say what was searched.",
        source: d.source ?? null,
        documents: (d.documents ?? []).map((x) => ({ kind: x.kind ?? null, url: x.url ?? null })).filter((x) => x.url),
        notes: d.notes ?? null,
        last_verified: d.last_verified ?? null,
      },
      ask:
        `Find ${d.name}'s BOARD POLICY on corporal punishment: the board policy manual (BoardDocs, Simbli/eBOARD, TASB Policy Online, Diligent Community, a 'Board Policies' page on the district site), not the student handbook. ` +
        "Quote verbatim the sentence that settles whether the board permits, prohibits, or requires parental consent for corporal punishment; give the policy code (JDA, FO(LOCAL), 5.02 and the like) and the URL of the policy page itself. " +
        "If the manual is online and has no corporal punishment policy, submit status 'silent' with the manual's URL as source and list in notes the sections you read. If you cannot find a manual online at all, submit status 'unknown' with what you searched. " +
        "fetch_document reads PDFs and pages for you; fetch_tasb_policy reads Texas FO(LOCAL); fetch_simbli_policy reads Simbli sites.",
      submit_as: {
        tool: "submit_finding",
        task: RECORD_COMPLETION,
        record: { state: d.state, name: d.name, nces_id: isNces(d.nces_id) ? String(d.nces_id) : null, county: d.county ?? null, status: "allows | bans | consent_required | silent | unknown", source: "<URL of the policy page>", quote: "<the sentence, verbatim>", policy_code: "<code or null>", last_verified: "<YYYY-MM-DD>", notes: "<what you read and where>" },
      },
    };
    (byState.get(d.state) ?? byState.set(d.state, []).get(d.state)).push(unit);
  }
  const byEnrollment = (a, b) => (b.enrollment ?? -1) - (a.enrollment ?? -1) || a.district.localeCompare(b.district);
  for (const list of byState.values()) list.sort(byEnrollment);
  // The exposed states in exposure order, one district from each in turn, biggest first; then every other
  // state the same way. The first N claims land on the largest district of each exposed state.
  const exposed = exposure.filter((st) => byState.has(st)).map((st) => byState.get(st));
  const rest = [...byState.keys()].filter((st) => !exposure.includes(st)).sort().map((st) => byState.get(st));
  return [...roundRobin(exposed), ...roundRobin(rest)];
}

// ---------------------------------------------------------------- neighbor-ask-research
// The banning district nearest to a target: the anchors next-targets.json already computed (same county
// first), else the largest banning district in the same county on the record.
function neighborThatBanned(target, districts, enrollment) {
  const anchors = Array.isArray(target.anchors) ? target.anchors : [];
  const pick = anchors.find((a) => a.same_county) ?? anchors[0] ?? null;
  if (pick) return { name: pick.name, nces_id: isNces(pick.district_id) ? pick.district_id : null, basis: pick.basis ?? null, same_county: Boolean(pick.same_county), how_known: "data/game/next-targets.json anchors" };
  const same = districts.filter((d) => d.state === target.state && d.status === "bans" && d.county && target.county && String(d.county).toLowerCase() === String(target.county).toLowerCase());
  same.sort((a, b) => (enrollment.get(String(b.nces_id)) ?? -1) - (enrollment.get(String(a.nces_id)) ?? -1));
  const d = same[0];
  if (!d) return null;
  return { name: d.name, nces_id: isNces(d.nces_id) ? String(d.nces_id) : null, basis: "record", same_county: true, source: d.source ?? null, how_known: "the record: a banning district in the same county" };
}

export function neighborAskUnits(crew, game) {
  const ranked = Array.isArray(game?.targets?.ranked) ? game.targets.ranked : [];
  const districts = allDistricts(crew);
  const enrollment = game?.enrollment ?? new Map();
  const byId = new Map(districts.filter((d) => isNces(d.nces_id)).map((d) => [String(d.nces_id), d]));
  return ranked.map((r) => {
    const rec = isNces(r.district_id) ? byId.get(r.district_id) : null;
    const neighbor = neighborThatBanned(r, districts, enrollment);
    const anchors = (Array.isArray(r.anchors) ? r.anchors : []).map((a) => ({ name: a.name, nces_id: isNces(a.district_id) ? a.district_id : null, basis: a.basis ?? null, same_county: Boolean(a.same_county) }));
    return {
      task: NEIGHBOR_ASK,
      scope: `${r.name}, ${r.state}`,
      district: r.name,
      state: r.state,
      county: r.county ?? null,
      nces_id: isNces(r.district_id) ? r.district_id : null,
      enrollment: r.enrollment ?? null,
      record_status: r.status ?? rec?.status ?? null,
      policy_source: rec?.source ?? null,
      website: rec ? websiteOf(rec) : null,
      on_file: {
        superintendent: rec?.contact?.superintendent ?? null,
        office_email: r.contact_email ?? rec?.contact?.district_email ?? null,
        board_page: rec?.contact?.board_page ?? null,
        last_move: r.last_move ? { kind: r.last_move.kind ?? null, sent_at: r.last_move.sent_at ?? null } : null,
        note: "What the record holds today. Confirm or correct it from the district's own pages; a changed superintendent is the usual finding.",
      },
      neighbor_that_banned: neighbor,
      other_banning_neighbors: anchors.filter((a) => !neighbor || a.name !== neighbor.name),
      ask:
        `${r.name} permits corporal punishment on paper and sits next to ${neighbor ? neighbor.name : "a district"} which moved to a ban. Collect, with the URL each item was read from: ` +
        "(1) the current superintendent's name and the public office email the district publishes for that office (never a personal mailbox; if the district publishes only a web form, say so); " +
        "(2) every board member's name and seat or role, from the district's board page; " +
        "(3) the date of the next regular board meeting, from the posted schedule or agenda; " +
        "(4) the name of the neighboring district that already moved to a ban, confirming or correcting neighbor_that_banned. " +
        "Submit one record with kind 'contacts'. Do not write to anyone: nothing is sent by this task, and nothing from it is used without a person reading it first.",
      submit_as: {
        tool: "submit_finding",
        task: NEIGHBOR_ASK,
        record: {
          kind: "contacts", state: r.state, name: r.name, nces_id: isNces(r.district_id) ? r.district_id : null, as_of: "<YYYY-MM-DD>",
          superintendent: { name: "<name>", email: "<office email or null>", source: "<URL>" },
          board_members: [{ name: "<name>", role: "<President, District 3, Member ...>", source: "<URL>" }],
          next_board_meeting: { date: "<YYYY-MM-DD>", source: "<URL>" },
          neighbor_ban: { name: neighbor?.name ?? "<name>", nces_id: neighbor?.nces_id ?? null, source: "<URL or null>" },
          notes: "<anything a reviewer needs>",
        },
      },
    };
  });
}

// ---------------------------------------------------------------- the queues, once per process
const cache = new Map();
export function generatedUnits(crew, crewDir) {
  const key = crew?.root ?? crewDir;
  if (cache.has(key)) return cache.get(key);
  const game = loadGame(crewDir);
  const units = {
    [RECORD_COMPLETION]: recordCompletionUnits(crew, game),
    [NEIGHBOR_ASK]: neighborAskUnits(crew, game),
  };
  const byScope = new Map();
  for (const [task, list] of Object.entries(units)) for (const u of list) byScope.set(`${task}\u0000${u.scope.toLowerCase()}`, u);
  const result = { units, byScope, game: { score_as_of: game.score?.as_of ?? null, targets_as_of: game.targets?.as_of ?? null } };
  cache.set(key, result);
  return result;
}

// Give the two tasks their scopes, in the order units should be handed out. The engine hands out the first
// scope no live lease overlaps and no finding has already covered, so the order is the priority.
export function attachGeneratedScopes(crew, crewDir) {
  const { units } = generatedUnits(crew, crewDir);
  const counts = {};
  for (const [task, list] of Object.entries(units)) {
    const t = crew?.tasksById?.[task];
    if (!t) continue;
    t.scopes = list.map((u) => u.scope);
    counts[task] = t.scopes.length;
  }
  return counts;
}

// One unit, for get_worklist and for claim_task's inline units. `task` narrows the lookup; without it the
// scope is looked up in both queues.
export function describeGeneratedScope(crew, crewDir, scope, task) {
  const { byScope, game } = generatedUnits(crew, crewDir);
  const key = String(scope ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const tasks = task ? [task] : [RECORD_COMPLETION, NEIGHBOR_ASK];
  for (const t of tasks) {
    const u = byScope.get(`${t}\u0000${key}`);
    if (u) return { ...u, generated_from: t === RECORD_COMPLETION ? { record: "data/districts/<ST>.yaml", order: `data/game/score.json permitting_states_by_exposure (as of ${game.score_as_of ?? "?"}), one district per state in turn, largest enrollment first` } : { record: "data/game/next-targets.json ranked", as_of: game.targets_as_of ?? null }, next: `Do what \`ask\` says, then submit_finding for task '${t}' with the record shaped like \`submit_as.record\`.` };
  }
  return null;
}
