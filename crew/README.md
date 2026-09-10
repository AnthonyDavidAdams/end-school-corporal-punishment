# This campaign as a Ground Crew crew

`crew.json`, `values.md`, `tasks/tasks.yaml` and `schemas/` describe this campaign to [Ground Crew](https://github.com/AnthonyDavidAdams/groundcrew), EarthPilot's open protocol for pointing many people's agents at one public problem. Everything else the server needs (facts, data, the agent contract, templates, skills) is the campaign repository itself.

Live server: https://escp-mcp-production.up.railway.app/mcp (Streamable HTTP; `/healthz`). Paste that URL into Claude.ai, ChatGPT, Claude Desktop or Cursor as a connector and ask your assistant to help; it will read the contract, claim a scope, and submit findings that are checked against their sources and reviewed before merge.

Run it yourself: `docker build -f crew/Dockerfile -t escp-crew . && docker run -p 3000:3000 -e ESCP_MAINTAINER_TOKEN=... escp-crew`, or without Docker, `npx github:AnthonyDavidAdams/groundcrew serve <assembled crew dir> --http`.

Approved findings are merged into `data/` by a maintainer with `groundcrew findings` and the campaign's `tools/merge-scan.mjs`.
