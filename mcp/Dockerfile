# Build from the REPOSITORY ROOT so the data directories are in the build context:
#
#   docker build -f mcp/Dockerfile -t escp-mcp .
#   docker run --rm -p 3000:3000 escp-mcp
#
# Stage 1 regenerates site/data/*.json from facts/ and data/ so the image never ships stale JSON.
FROM node:22-alpine AS data
WORKDIR /src
COPY tools/package.json tools/package-lock.json* ./tools/
RUN cd tools && npm ci --omit=dev --no-audit --no-fund
COPY tools/ ./tools/
COPY facts/ ./facts/
COPY data/ ./data/
RUN cd tools && node build-site-data.mjs

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 ESCP_ROOT=/app
WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY mcp/server.mjs ./
# Everything server.mjs reads, at the same paths as in the repository (ESCP_ROOT=/app).
COPY --from=data /src/site/data /app/site/data
COPY data/crdc /app/data/crdc
COPY tasks/README.md /app/tasks/README.md
COPY templates /app/templates
COPY AGENTS.md /app/AGENTS.md
COPY skills/district-policy-scan/SKILL.md /app/skills/district-policy-scan/SKILL.md
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["node", "server.mjs", "--http"]
