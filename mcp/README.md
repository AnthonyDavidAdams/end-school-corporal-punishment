# escp-mcp

An [MCP](https://modelcontextprotocol.io) server that lets any agent platform read this project's verified facts, state and district data, and federal CRDC counts, and submit findings as GitHub issues. Claude Code, Claude Desktop, ChatGPT, Cursor, and anything else that speaks MCP over stdio or Streamable HTTP can use it.

It serves only files built or kept in the repository: `site/data/*.json` (built from `facts/` and `data/` by `tools/build-site-data.mjs`), `data/crdc/*.csv`, `tasks/README.md`, `templates/*.md`, `AGENTS.md`, and the district-scan skill. Nothing is parsed from YAML at request time.

## What it exposes

Tools (read, no auth):

| Tool | Returns |
|---|---|
| `search_facts({query, status?})` | Claims matching every word in `query` (id, claim, tags, body); retired claims excluded unless `status` given |
| `get_fact({id})` | One claim in full: sources, tags, verification metadata, body note |
| `list_states({status?})` | code, name, status (`banned` / `legal` / `partial`), year_banned, last_verified |
| `get_state({code})` | The state's record, its district entries, and its row from every CRDC year |
| `get_districts({state, status?})` | District policy entries (`allows` / `bans` / `consent_required` / `unknown`) |
| `get_crdc({year?, state?})` | National series and per-year state tables, with each year's `SOURCE.md` |
| `list_tasks()` | The task queue (task, unit, output, priority) and the "Done means" list |
| `get_agent_contract()` | Full text of `AGENTS.md` |
| `list_templates()` / `get_template({name})` | Model bill, district policy, resolution, letters, testimony, records request |

Tools (write):

| Tool | Does |
|---|---|
| `submit_district_finding({state, district, status, source, quote, nces_id?, policy_code?, notes?, submitted_by})` | Files a `[district] <ST> <District>: <status>` issue with label `district-policy` |
| `submit_fact_correction({claim_id, problem, source, submitted_by})` | Files a `[fact] <id>` issue with label `facts` |

Both validate input (status enum, http(s) source URL, non-empty quote, 7-digit NCES id) and refuse a district finding for a state that bans by law. With `GITHUB_TOKEN` set they create the issue on `AnthonyDavidAdams/end-school-corporal-punishment` and return its URL. Without a token they return the fully formed issue body plus a prefilled `issues/new?template=...` URL to open by hand. The tool descriptions tell the agent it must have opened the source itself in the same session; the server cannot check that, so the [agent contract](../AGENTS.md) still applies.

Resources: `escp://facts` (claims.json) and `escp://states` (states.json).

Prompt: `district-scan` (optional argument `state`) returns the `district-policy-scan` skill plus `AGENTS.md`.

## Running

Requires Node 22+. Build the JSON first, then install:

```sh
cd tools && npm install && npm run build-site-data && cd ..
cd mcp && npm install
```

stdio (what desktop clients spawn):

```sh
node server.mjs            # or: npm start
```

Streamable HTTP, endpoint `POST /mcp`, health check `GET /healthz`:

```sh
node server.mjs --http --port 3000       # or: npm run start:http
curl localhost:3000/healthz
```

`--port` defaults to `$PORT` then 3000; `--host` defaults to `$HOST` then `0.0.0.0`. The HTTP server is stateless (no session ids), so it runs fine behind a load balancer.

Tests spawn both transports:

```sh
npm test
```

## Connecting clients

Claude Code:

```sh
claude mcp add escp -- node /absolute/path/to/end-school-corporal-punishment/mcp/server.mjs
# or a hosted instance:
claude mcp add --transport http escp https://your-host.example/mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "escp": {
      "command": "node",
      "args": ["/absolute/path/to/end-school-corporal-punishment/mcp/server.mjs"],
      "env": { "GITHUB_TOKEN": "ghp_optional" }
    }
  }
}
```

Cursor (`.cursor/mcp.json`), and the generic shape most HTTP-capable clients accept:

```json
{
  "mcpServers": {
    "escp": { "url": "https://your-host.example/mcp" }
  }
}
```

ChatGPT: Settings > Connectors > Create, with the server URL `https://your-host.example/mcp`, no authentication. ChatGPT requires a public HTTPS host, so deploy first (below).

## Environment variables

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Optional. A token with `issues:write` on the repository; when set, `submit_*` tools create issues directly. Leave unset to get the manual-URL path. |
| `PORT` | HTTP port when `--port` is not given (Railway sets this). |
| `HOST` | HTTP bind address, default `0.0.0.0`. |
| `ESCP_ROOT` | Directory holding `site/data`, `data/crdc`, `tasks`, `templates`, `AGENTS.md`, `skills`. Defaults to the repository root, falling back to `mcp/vendor/`. |

## Deploying

### Docker

Build from the **repository root** so the data directories are in the context; the first stage regenerates `site/data/*.json` from `facts/` and `data/`:

```sh
docker build -f mcp/Dockerfile -t escp-mcp .
docker run --rm -p 3000:3000 escp-mcp
curl localhost:3000/healthz
```

### Railway

Railway builds from the directory you run `railway up` in, so copy the data into `mcp/vendor/` first (gitignored; the server falls back to it when the repo root is absent):

```sh
cd tools && npm run build-site-data && cd ../mcp
npm run vendor
railway up
```

Service settings: start command `node server.mjs --http`; Railway injects `PORT`. Add `GITHUB_TOKEN` as a variable if you want issues filed directly. Re-run `npm run vendor && railway up` whenever `facts/` or `data/` change.

Alternatively point the service at the repository root with `RAILWAY_DOCKERFILE_PATH=mcp/Dockerfile`, which uses the Docker build above and needs no vendoring.

## Refreshing data

The server reads everything once at startup. After editing `facts/claims/*.md`, `data/states/*.yaml`, or `data/districts/*.yaml`, run `cd tools && npm run build-site-data` and restart the server.
