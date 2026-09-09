// Smoke test: stdio transport through the SDK client, then the HTTP transport (/healthz + one MCP call).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "server.mjs");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "GITHUB_TOKEN"));
const parse = (r) => { assert.ok(!r.isError, `tool returned error: ${r.content?.[0]?.text}`); return JSON.parse(r.content[0].text); };
let passed = 0;
const ok = (name) => { passed++; console.log(`ok - ${name}`); };

// ---- stdio ----
{
  const client = new Client({ name: "escp-mcp-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env, stderr: "pipe" }));

  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const t of ["search_facts", "get_fact", "get_state", "list_states", "get_districts", "get_crdc", "list_tasks", "get_agent_contract", "get_template", "list_templates", "submit_district_finding", "submit_fact_correction"]) assert.ok(tools.includes(t), `missing tool ${t}`);
  ok(`list_tools: ${tools.length} tools`);

  const facts = parse(await client.callTool({ name: "search_facts", arguments: { query: "Mississippi" } }));
  assert.ok(facts.count > 0 && facts.results.every((r) => r.id && r.claim && r.status !== "retired"));
  ok(`search_facts Mississippi: ${facts.count} claims`);

  const fact = parse(await client.callTool({ name: "get_fact", arguments: { id: facts.results[0].id } }));
  assert.ok(Array.isArray(fact.sources) && fact.sources.length && typeof fact.body === "string");
  ok(`get_fact ${fact.id}`);

  const ms = parse(await client.callTool({ name: "get_state", arguments: { code: "MS" } }));
  assert.equal(ms.code, "MS"); assert.equal(ms.name, "Mississippi");
  assert.ok(ms.districts.length > 0, "MS districts");
  assert.ok(Object.keys(ms.crdc).length > 0 && ms.crdc["2021-22"]?.students > 0, "MS crdc rows");
  ok(`get_state MS: ${ms.districts.length} districts, crdc years ${Object.keys(ms.crdc).join("/")}`);

  const states = parse(await client.callTool({ name: "list_states", arguments: { status: "legal" } }));
  assert.ok(states.count > 0 && states.states.every((s) => s.status === "legal"));
  ok(`list_states legal: ${states.count}`);

  const crdc = parse(await client.callTool({ name: "get_crdc", arguments: { year: "2021-22", state: "TX" } }));
  assert.equal(crdc.national.length, 1); assert.equal(crdc.states["2021-22"][0].state, "TX");
  ok("get_crdc 2021-22 TX");

  const tasks = parse(await client.callTool({ name: "list_tasks", arguments: {} }));
  assert.ok(tasks.tasks.length >= 5 && tasks.tasks[0].task === "district-policy-scan" && tasks.tasks[0].priority === 1);
  assert.ok(tasks.done_means.length >= 3);
  ok(`list_tasks: ${tasks.tasks.length} tasks, ${tasks.done_means.length} done-means`);

  const contract = await client.callTool({ name: "get_agent_contract", arguments: {} });
  assert.ok(contract.content[0].text.includes("Open the source"));
  ok("get_agent_contract");

  const templates = parse(await client.callTool({ name: "list_templates", arguments: {} }));
  assert.ok(templates.templates.length >= 5);
  const tpl = await client.callTool({ name: "get_template", arguments: { name: templates.templates[0].name } });
  assert.ok(tpl.content[0].text.length > 100);
  ok(`list_templates/get_template: ${templates.templates.length} templates`);

  const finding = parse(await client.callTool({
    name: "submit_district_finding",
    arguments: { state: "MS", district: "Rankin County School District", status: "allows", source: "https://example.org/policy-JDA", quote: "Corporal punishment may be administered by the principal.", nces_id: "2803720", submitted_by: "escp-mcp test" },
  }));
  assert.equal(finding.created, false);
  assert.ok(finding.open_url.startsWith("https://github.com/AnthonyDavidAdams/end-school-corporal-punishment/issues/new?template=district-policy.yml&title="), finding.open_url);
  assert.equal(finding.issue.title, "[district] MS Rankin County School District: allows");
  assert.ok(finding.issue.body.includes("### Status\n\nallows") && finding.issue.body.includes("https://example.org/policy-JDA"));
  ok("submit_district_finding without token -> manual URL");

  const bad = await client.callTool({ name: "submit_district_finding", arguments: { state: "MS", district: "X", status: "allows", source: "ftp://nope", quote: "", submitted_by: "t" } });
  assert.ok(bad.isError, "invalid input must be rejected");
  ok("submit_district_finding rejects bad source/empty quote");

  const corr = parse(await client.callTool({ name: "submit_fact_correction", arguments: { claim_id: fact.id, problem: "test", source: "https://example.org/x", submitted_by: "escp-mcp test" } }));
  assert.equal(corr.created, false); assert.ok(corr.open_url.includes("template=fact-correction.yml"));
  ok("submit_fact_correction without token -> manual URL");

  const res = await client.listResources();
  assert.ok(res.resources.some((r) => r.uri === "escp://facts") && res.resources.some((r) => r.uri === "escp://states"));
  const factsRes = await client.readResource({ uri: "escp://facts" });
  assert.ok(JSON.parse(factsRes.contents[0].text).length > 0);
  ok("resources escp://facts, escp://states");

  const prompt = await client.getPrompt({ name: "district-scan", arguments: { state: "Mississippi" } });
  assert.ok(prompt.messages[0].content.text.includes("District policy scan") && prompt.messages[0].content.text.includes("Argument: Mississippi"));
  ok("prompt district-scan");

  await client.close();
}

// ---- http ----
{
  const child = spawn(process.execPath, [serverPath, "--http", "--port", "0", "--host", "127.0.0.1"], { env, stdio: ["ignore", "ignore", "pipe"] });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    child.stderr.on("data", (d) => { buf += d; const m = buf.match(/listening on http:\/\/[^:]+:(\d+)\/mcp/); if (m) resolve(Number(m[1])); });
    child.on("exit", (c) => reject(new Error(`http server exited ${c}: ${buf}`)));
    setTimeout(() => reject(new Error("http server did not start")), 10000);
  });
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
    assert.equal(health.ok, true); assert.ok(health.claims > 0);
    ok(`GET /healthz on :${port}: ${health.claims} claims`);

    const client = new Client({ name: "escp-mcp-test-http", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const facts = parse(await client.callTool({ name: "search_facts", arguments: { query: "OECD" } }));
    assert.ok(facts.count > 0);
    await client.close();
    ok(`HTTP transport search_facts OECD: ${facts.count} claims`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => child.on("exit", r));
  }
}

console.log(`\n${passed} checks passed`);
