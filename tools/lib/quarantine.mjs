// Records whose cited document belongs to some other district: another state's district of the same
// name (Whitehall, Wisconsin quoting Whitehall, Montana), or in Texas the neighbouring district whose
// TASB manual a fragment row picked up. The record still says "bans", and until a corrected finding is
// merged the site must not congratulate a board on a policy it never adopted.
//
// The match is on the exact source URL as well as the district, so a merged correction that cites the
// district's own document releases it with nobody editing this list. The district is matched by name or
// NCES id, never by URL alone: in Texas the quarantined URL is the neighbour's own, correct source.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const QUARANTINE = JSON.parse(readFileSync(join(root, "data/quarantine/wrong-source.json"), "utf8"));

export const wrongSource = (state, d) => (d?.source && QUARANTINE.find((q) => q.state === state && q.source === d.source
  && (q.name === d.name || (q.nces_id && d.nces_id && q.nces_id === String(d.nces_id))))) || null;
