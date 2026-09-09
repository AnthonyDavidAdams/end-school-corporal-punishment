// Copies the files the MCP server reads into mcp/vendor/ (same layout as the repo root) so that
// `railway up` or `docker build` from mcp/ alone has data. Run `cd tools && npm run build-site-data` first.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, "vendor");
const paths = ["site/data", "data/crdc", "tasks/README.md", "templates", "AGENTS.md", "skills/district-policy-scan/SKILL.md"];

if (!existsSync(join(root, "site/data/claims.json"))) {
  console.error("site/data/claims.json missing: run `cd tools && npm i && npm run build-site-data` first");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
for (const p of paths) {
  mkdirSync(dirname(join(out, p)), { recursive: true });
  cpSync(join(root, p), join(out, p), { recursive: true });
}
console.log(`vendored ${paths.length} paths into mcp/vendor/`);
