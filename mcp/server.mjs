#!/usr/bin/env node
// MCP server for the End School Corporal Punishment project.
//
//   node server.mjs                       stdio transport (Claude Code, Claude Desktop, Cursor, ...)
//   node server.mjs --http [--port 3000]  Streamable HTTP transport on POST /mcp, plus GET /healthz
//
// Reads only JSON/CSV/Markdown built or kept in the repository; never parses data/*.yaml at request time.
// Run `cd tools && npm run build-site-data` after editing facts/ or data/ to refresh site/data/*.json.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const VERSION = "0.1.0";
const REPO = "AnthonyDavidAdams/end-school-corporal-punishment";
const GITHUB_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// Locate the data root: ESCP_ROOT env, else the repo root, else mcp/vendor (made by `npm run vendor`
// for deploys that ship only the mcp/ directory).
// ---------------------------------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
function resolveRoot() {
  const candidates = [process.env.ESCP_ROOT, join(here, ".."), join(here, "vendor")].filter(Boolean);
  for (const c of candidates) if (existsSync(join(c, "site/data/claims.json"))) return c;
  throw new Error(
    `Cannot find site/data/claims.json under any of: ${candidates.join(", ")}. ` +
      `Run \`cd tools && npm i && npm run build-site-data\` first, or set ESCP_ROOT.`
  );
}
const root = resolveRoot();
const read = (p) => readFileSync(join(root, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

// ---------------------------------------------------------------------------
// CSV: small quote-aware parser; numeric cells become numbers, empty cells become null.
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  return body.map((r) =>
    Object.fromEntries(header.map((h, i) => {
      const v = r[i] ?? "";
      if (v === "") return [h, null];
      return [h, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v];
    }))
  );
}

// ---------------------------------------------------------------------------
// Load everything once.
// ---------------------------------------------------------------------------
const data = (() => {
  const claims = readJson("site/data/claims.json");
  const states = readJson("site/data/states.json");
  const districts = readJson("site/data/districts.json");
  const summary = existsSync(join(root, "site/data/summary.json")) ? readJson("site/data/summary.json") : null;

  const crdcDir = join(root, "data/crdc");
  const crdc = { national: parseCsv(read("data/crdc/national.csv")), states: {}, sources: {} };
  for (const year of readdirSync(crdcDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const f = join(crdcDir, year, "states.csv");
    if (existsSync(f)) crdc.states[year] = parseCsv(readFileSync(f, "utf8"));
    const s = join(crdcDir, year, "SOURCE.md");
    if (existsSync(s)) crdc.sources[year] = readFileSync(s, "utf8");
  }

  const templates = {};
  for (const f of readdirSync(join(root, "templates")).filter((f) => f.endsWith(".md")).sort()) templates[basename(f, ".md")] = read(join("templates", f));

  return {
    claims,
    claimsById: Object.fromEntries(claims.map((c) => [c.id, c])),
    states,
    stateByName: Object.fromEntries(Object.values(states).map((s) => [s.name.toLowerCase(), s.code])),
    districts,
    summary,
    crdc,
    templates,
    tasksMd: read("tasks/README.md"),
    agentsMd: read("AGENTS.md"),
    districtScanSkill: read("skills/district-policy-scan/SKILL.md"),
  };
})();

function stateCode(input) {
  const s = String(input).trim();
  if (data.states[s.toUpperCase()]) return s.toUpperCase();
  return data.stateByName[s.toLowerCase()] ?? null;
}

function claimSummary(c) {
  const primary = (c.sources ?? []).find((s) => s.primary) ?? (c.sources ?? [])[0];
  return {
    id: c.id,
    claim: c.claim,
    status: c.status,
    figure: c.figure ?? null,
    as_of: c.as_of ?? null,
    primary_source: primary?.url ?? null,
    last_verified: c.last_verified ?? null,
  };
}

function parseTasks(md) {
  const tasks = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 4 || cells[0] === "Task" || /^-+$/.test(cells[0])) continue;
    const clean = (s) => s.replace(/[`*]/g, "").trim();
    const pr = clean(cells[3]);
    tasks.push({ task: clean(cells[0]), unit: clean(cells[1]), output: clean(cells[2]), priority: /^\d+$/.test(pr) ? Number(pr) : pr });
  }
  const done = [];
  const m = md.match(/## Done means\s*\n([\s\S]*?)(?:\n## |$)/);
  if (m) for (const l of m[1].split("\n")) if (/^\s*[-*] /.test(l)) done.push(l.replace(/^\s*[-*] /, "").trim());
  return { tasks, done_means: done };
}

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

// ---------------------------------------------------------------------------
// GitHub issue submission (shared by both submit_* tools).
// ---------------------------------------------------------------------------
const httpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL");

function issueBodyFromFields(fields, submittedBy) {
  // Same shape GitHub renders for an issue-form submission: "### <label>\n\n<value>" per field.
  const parts = fields.filter(([, v]) => v != null && String(v).trim() !== "").map(([label, v]) => `### ${label}\n\n${String(v).trim()}`);
  parts.push(`### Submitted by\n\n${submittedBy.trim()} (via escp-mcp ${VERSION})`);
  return parts.join("\n\n");
}

async function submitIssue({ template, title, body, labels, prefill }) {
  const params = new URLSearchParams({ template, title, ...prefill });
  const open_url = `https://github.com/${REPO}/issues/new?${params.toString()}`;
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { created: false, reason: "GITHUB_TOKEN not set; open the URL to file this issue yourself", open_url, issue: { title, labels, body } };
  }
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": `escp-mcp/${VERSION}`,
    },
    body: JSON.stringify({ title, body, labels }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { created: false, reason: `GitHub API ${res.status}: ${detail.slice(0, 500)}`, open_url, issue: { title, labels, body } };
  }
  const issue = await res.json();
  return { created: true, url: issue.html_url, number: issue.number, issue: { title, labels, body } };
}

// ---------------------------------------------------------------------------
// Server factory. One instance for stdio; one per request for stateless HTTP.
// ---------------------------------------------------------------------------
export function createServer() {
  const server = new McpServer(
    { name: "escp", version: VERSION },
    {
      instructions:
        "Verified facts and data for ending corporal punishment in US public schools. Every figure comes from facts/claims with a primary source and verification date; quote only status 'verified' claims as fact, and 'reported' ones only as 'according to <source>'. " +
        "Call get_agent_contract before submitting anything. Submission tools file GitHub issues: never submit a status, quote, or source you have not opened and read yourself in this session.",
    }
  );

  // ---- facts ----
  server.registerTool(
    "search_facts",
    {
      title: "Search verified facts",
      description:
        "Keyword search over the claims registry (facts/claims). Matches case-insensitively against claim id, claim sentence, tags, and body note; all words in the query must match. Returns id, claim, status, figure, as_of, primary source URL, and last_verified. Retired (superseded) claims are excluded unless you pass status. Use get_fact for full sources and the usage note.",
      inputSchema: {
        query: z.string().min(1).describe("Words to match, e.g. 'Mississippi', 'black students 2021-22', 'OECD'"),
        status: z.enum(["verified", "reported", "disputed", "retired"]).optional().describe("Restrict to one status. Omit to get every non-retired claim that matches."),
      },
    },
    async ({ query, status }) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const results = data.claims
        .filter((c) => (status ? c.status === status : c.status !== "retired"))
        .filter((c) => {
          const hay = [c.id, c.claim, ...(c.tags ?? []), c.body ?? "", c.as_of ?? ""].join(" ").toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .map(claimSummary);
      return text({ query, status: status ?? "all except retired", count: results.length, results });
    }
  );

  server.registerTool(
    "get_fact",
    {
      title: "Get one claim in full",
      description: "Return one claim from facts/claims by id: the sentence, status, figure, as_of, every source (url, title, publisher, date, primary flag), tags, verification metadata, supersedes/superseded_by, and the markdown body explaining what the number counts and how to use it.",
      inputSchema: { id: z.string().min(1).describe("Claim id, e.g. 'crdc-national-total-2021-22' (the filename without .md)") },
    },
    async ({ id }) => {
      const c = data.claimsById[id.trim()];
      if (!c) {
        const near = data.claims.filter((x) => x.id.includes(id.trim().toLowerCase())).map((x) => x.id).slice(0, 10);
        return fail(`No claim with id '${id}'.${near.length ? ` Similar ids: ${near.join(", ")}` : " Use search_facts to find ids."}`);
      }
      return text(c);
    }
  );

  // ---- states and districts ----
  server.registerTool(
    "list_states",
    {
      title: "List states",
      description: "All 50 states plus DC with legal status of school corporal punishment: 'banned' (prohibited by statute or rule), 'legal' (permitted by statute), or 'partial' (permitted by statute but every district has stopped by policy). Returns code, name, status, year_banned, last_verified. Filter with status.",
      inputSchema: { status: z.enum(["banned", "legal", "partial"]).optional().describe("Only return states with this status") },
    },
    async ({ status }) => {
      const rows = Object.values(data.states)
        .filter((s) => !status || s.status === status)
        .map((s) => ({ code: s.code, name: s.name, status: s.status, year_banned: s.year_banned ?? null, last_verified: s.last_verified ?? null }))
        .sort((a, b) => a.code.localeCompare(b.code));
      return text({ count: rows.length, states: rows });
    }
  );

  server.registerTool(
    "get_state",
    {
      title: "Get one state",
      description: "Everything recorded for one state: legal status, statute and URL, statutory limits, bills by session, notes, sources, and last_verified; plus its district policy entries (data/districts) and its rows from every CRDC release year (data/crdc/<year>/states.csv: students struck, by race/sex/disability, per 1,000 enrolled).",
      inputSchema: { code: z.string().min(2).describe("Two-letter state code or full state name, e.g. 'MS' or 'Mississippi'") },
    },
    async ({ code }) => {
      const cc = stateCode(code);
      if (!cc) return fail(`Unknown state '${code}'. Use a two-letter code or full name.`);
      const crdc = {};
      for (const [year, rows] of Object.entries(data.crdc.states)) {
        const r = rows.find((x) => x.state === cc);
        if (r) crdc[year] = r;
      }
      return text({ ...data.states[cc], districts: data.districts[cc] ?? [], crdc });
    }
  );

  server.registerTool(
    "get_districts",
    {
      title: "Get district policies for a state",
      description: "District-level corporal punishment policy entries for one state (data/districts/<XX>.yaml): name, county, nces_id, status (allows | bans | consent_required | unknown), source URL, verbatim quote, policy_code, last_verified, notes. An entry with source null is unsourced and is a candidate for the district-policy-scan task. Filter with status.",
      inputSchema: {
        state: z.string().min(2).describe("Two-letter state code or full state name"),
        status: z.enum(["allows", "bans", "consent_required", "unknown"]).optional().describe("Only return districts with this status"),
      },
    },
    async ({ state, status }) => {
      const cc = stateCode(state);
      if (!cc) return fail(`Unknown state '${state}'.`);
      const all = data.districts[cc] ?? [];
      const rows = all.filter((d) => !status || d.status === status);
      return text({ state: cc, recorded: all.length, sourced: all.filter((d) => d.source).length, count: rows.length, districts: rows });
    }
  );

  // ---- CRDC ----
  server.registerTool(
    "get_crdc",
    {
      title: "Get CRDC corporal punishment counts",
      description:
        "Federal Civil Rights Data Collection extracts (data/crdc). Returns the national series (year, students, instances, boys_share, black_share, black_enrollment_share, idea_share, source, status) and the per-year state tables. Counts are students who received corporal punishment at least once, not incidents, and districts self-report with documented undercounting. Filter by year (e.g. '2021-22') and/or state code. Each year's SOURCE.md is returned as provenance.",
      inputSchema: {
        year: z.string().optional().describe("Release year like '2021-22'. Omit for all years."),
        state: z.string().optional().describe("Two-letter state code or name. Omit for all states."),
      },
    },
    async ({ year, state }) => {
      const cc = state ? stateCode(state) : null;
      if (state && !cc) return fail(`Unknown state '${state}'.`);
      const years = Object.keys(data.crdc.states).filter((y) => !year || y === year);
      if (year && !years.length && !data.crdc.national.some((r) => r.year === year)) return fail(`No CRDC data for year '${year}'. Available: ${Object.keys(data.crdc.states).join(", ")}`);
      const states = Object.fromEntries(years.map((y) => [y, data.crdc.states[y].filter((r) => !cc || r.state === cc)]));
      const sources = Object.fromEntries(years.map((y) => [y, data.crdc.sources[y] ?? null]));
      return text({
        caveats: ["Counts are students, not incidents.", "Districts self-report; undercounting is documented.", "2020-21 is a pandemic year and not comparable.", "Column names change between releases; see sources."],
        national: data.crdc.national.filter((r) => !year || r.year === year),
        states,
        sources,
      });
    }
  );

  // ---- tasks, contract, templates ----
  server.registerTool(
    "list_tasks",
    {
      title: "List open tasks",
      description: "The project's open task queue from tasks/README.md: each task name, unit of work, expected output, and priority (1 is highest), plus the 'Done means' acceptance list. Claim a scope with the 'Claim a task' issue template before starting so work is not duplicated.",
      inputSchema: {},
    },
    async () => text(parseTasks(data.tasksMd))
  );

  server.registerTool(
    "get_agent_contract",
    {
      title: "Get the agent contract (AGENTS.md)",
      description: "The full text of AGENTS.md: the rules every agent must follow when contributing (open the source, primary sources first, quote verbatim, date everything, never guess, no student names, one scope per PR), the status definitions for district policies, where to find district policy manuals, and the district entry format. Read it before using any submit_* tool.",
      inputSchema: {},
    },
    async () => text(data.agentsMd)
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description: "Templates available in templates/: model state ban act, district policy, school board resolution, letters (principal opt-out, school board, state legislator), testimony (school board, legislative), op-ed, public records request. Returns name, title, and size. Use get_template to fetch one.",
      inputSchema: {},
    },
    async () =>
      text({
        templates: Object.entries(data.templates).map(([name, body]) => ({
          name,
          title: (body.match(/^#\s+(.+)$/m) ?? [])[1] ?? name,
          chars: body.length,
        })),
      })
  );

  server.registerTool(
    "get_template",
    {
      title: "Get a template",
      description: "Full markdown of one template from templates/ by name (with or without .md), e.g. 'letter-principal-opt-out', 'state-ban-act', 'district-policy'. Templates quote figures from facts/; check the claim status before reusing a number.",
      inputSchema: { name: z.string().min(1).describe("Template name, e.g. 'school-board-resolution'") },
    },
    async ({ name }) => {
      const key = name.trim().replace(/\.md$/, "");
      const body = data.templates[key];
      if (!body) return fail(`No template '${name}'. Available: ${Object.keys(data.templates).join(", ")}`);
      return text(body);
    }
  );

  // ---- submissions ----
  server.registerTool(
    "submit_district_finding",
    {
      title: "Submit a district policy finding",
      description:
        "File a district's corporal punishment policy as a GitHub issue on the project (label district-policy), in the shape of the 'District policy finding' issue form. " +
        "REQUIREMENTS: you must have opened the source URL yourself in this session and read the quoted sentence on that page; the quote must be verbatim; the status must follow AGENTS.md (allows = policy authorizes it even with conditions; consent_required = only with advance written parental permission; bans = policy prohibits it). Never submit from memory or from a secondary report. If you could not find a policy, do not submit; the status is unknown. " +
        "With GITHUB_TOKEN set the issue is created and its URL returned; without a token the tool returns the fully formed issue body and a prefilled GitHub URL to open manually.",
      inputSchema: {
        state: z.string().min(2).describe("Two-letter state code or full state name"),
        district: z.string().min(2).describe("District name as it appears in NCES, e.g. 'Rankin County School District'"),
        status: z.enum(["allows", "bans", "consent_required"]).describe("Policy status per AGENTS.md"),
        source: httpUrl.describe("URL of the board policy, handbook, or minutes that establishes the status; you must have opened it"),
        quote: z.string().trim().min(1).describe("Verbatim sentence from the source that establishes the status"),
        nces_id: z.string().regex(/^[0-9]{7}$/, "NCES LEA id is 7 digits").optional().describe("7-digit NCES district id from nces.ed.gov/ccd/districtsearch"),
        policy_code: z.string().optional().describe("Board policy number, e.g. 'JDA' or 'FO(LOCAL)'"),
        notes: z.string().optional().describe("Anything a reviewer needs: conflicting documents, board minutes date, what was searched"),
        submitted_by: z.string().min(1).describe("Who is submitting: a GitHub handle, or 'agent:<name> run by <person>'"),
      },
    },
    async (a) => {
      const cc = stateCode(a.state);
      if (!cc) return fail(`Unknown state '${a.state}'.`);
      const st = data.states[cc];
      if (st.status === "banned") return fail(`${st.name} prohibits corporal punishment by law (status 'banned'); district entries are not collected for banned states. If the law changed, use submit_fact_correction.`);
      const districtLabel = `${a.district.trim()}, ${cc}`;
      const title = `[district] ${cc} ${a.district.trim()}: ${a.status}`;
      const body = issueBodyFromFields(
        [
          ["District name and state", districtLabel],
          ["Status", a.status],
          ["Source URL (board policy, handbook, minutes)", a.source],
          ["Verbatim quote from the source that establishes the status", a.quote],
          ["NCES district ID (7 digits)", a.nces_id],
          ["Policy code", a.policy_code],
          ["Notes", a.notes],
        ],
        a.submitted_by
      );
      const prefill = { district: districtLabel, status: a.status, source: a.source, quote: a.quote };
      if (a.nces_id) prefill.nces = a.nces_id;
      const result = await submitIssue({ template: "district-policy.yml", title, body, labels: ["data", "district-policy"], prefill });
      return text({ ...result, yaml_entry: { name: a.district.trim(), nces_id: a.nces_id ?? null, status: a.status, source: a.source, quote: a.quote, policy_code: a.policy_code ?? null, last_verified: new Date().toISOString().slice(0, 10) } });
    }
  );

  server.registerTool(
    "submit_fact_correction",
    {
      title: "Submit a fact correction",
      description:
        "Report that a claim in facts/claims is wrong, stale, or missing, as a GitHub issue (label facts) in the shape of the 'Fact correction or new claim' issue form. " +
        "REQUIREMENTS: you must have opened the primary source URL yourself in this session and be describing what it actually says; never report a correction from memory. Use claim_id 'new' for a claim that should exist but does not. " +
        "With GITHUB_TOKEN set the issue is created; without a token the tool returns the issue body and a prefilled GitHub URL to open manually.",
      inputSchema: {
        claim_id: z.string().min(1).describe("Claim id (facts/claims/<id>.md) or 'new'"),
        problem: z.string().trim().min(1).describe("What is wrong or missing, and what the source actually says, with the exact figure or wording"),
        source: httpUrl.describe("Primary source URL that you opened"),
        submitted_by: z.string().min(1).describe("Who is submitting: a GitHub handle, or 'agent:<name> run by <person>'"),
      },
    },
    async (a) => {
      const id = a.claim_id.trim();
      if (id !== "new" && !data.claimsById[id]) return fail(`No claim with id '${id}'. Use search_facts to find the id, or pass 'new'.`);
      if (id !== "new" && data.claimsById[id].status === "retired") return fail(`Claim '${id}' is retired (superseded by ${data.claimsById[id].superseded_by ?? "a newer claim"}); corrections go to the current claim.`);
      const title = `[fact] ${id === "new" ? a.problem.trim().slice(0, 60) : id}`;
      const body = issueBodyFromFields(
        [
          ['Claim id (facts/claims/<id>.md) or "new"', id],
          ["What is wrong or missing, and what the source actually says", a.problem],
          ["Primary source URL", a.source],
        ],
        a.submitted_by
      );
      const result = await submitIssue({ template: "fact-correction.yml", title, body, labels: ["facts"], prefill: { claim: id, problem: a.problem, source: a.source } });
      return text(result);
    }
  );

  // ---- resources ----
  server.registerResource("facts", "escp://facts", { title: "Claims registry", description: "Every claim in facts/claims as JSON (site/data/claims.json)", mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data.claims, null, 1) }],
  }));
  server.registerResource("states", "escp://states", { title: "State legal status", description: "Legal status, statute, limits, and bills per state (site/data/states.json)", mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data.states, null, 1) }],
  }));

  // ---- prompts ----
  server.registerPrompt(
    "district-scan",
    {
      title: "District policy scan",
      description: "The district-policy-scan skill: find and record the corporal punishment policy of every public school district in a state, with source and verbatim quote. Pass a state (and optional slice) as the argument.",
      argsSchema: { state: z.string().optional().describe("State name or code, optionally with a slice, e.g. 'Texas, districts A-C'") },
    },
    ({ state }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `${data.districtScanSkill.trim()}\n\n---\n\nThe agent contract (AGENTS.md) that binds this skill:\n\n${data.agentsMd.trim()}` +
              (state ? `\n\n---\n\nArgument: ${state}` : "\n\n---\n\nNo state argument was given; ask which state to scan."),
          },
        },
      ],
    })
  );

  return server;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function runStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error(`escp-mcp ${VERSION} on stdio (root ${root}, ${data.claims.length} claims)`);
}

async function runHttp() {
  const port = Number(arg("--port", process.env.PORT ?? 3000));
  const host = arg("--host", process.env.HOST ?? "0.0.0.0");
  const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const rpcErr = (res, code, message) => json(res, code, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/healthz") {
      return json(res, 200, { ok: true, name: "escp-mcp", version: VERSION, claims: data.claims.length, states: Object.keys(data.states).length, districts: Object.values(data.districts).flat().length, generated: data.summary?.generated ?? null });
    }
    if (url.pathname === "/" && req.method === "GET") {
      return json(res, 200, { name: "escp-mcp", version: VERSION, mcp: "/mcp", health: "/healthz", repo: `https://github.com/${REPO}` });
    }
    if (url.pathname !== "/mcp") return json(res, 404, { error: "not found" });
    if (req.method !== "POST") return rpcErr(res, 405, "Method not allowed; this server is stateless, POST JSON-RPC to /mcp");
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("mcp request failed:", err);
      if (!res.headersSent) json(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });
  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  const actual = httpServer.address().port;
  console.error(`escp-mcp ${VERSION} http listening on http://${host}:${actual}/mcp (health: /healthz; root ${root}, ${data.claims.length} claims)`);
  const stop = () => httpServer.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  (process.argv.includes("--http") ? runHttp() : runStdio()).catch((err) => { console.error(err); process.exit(1); });
}
