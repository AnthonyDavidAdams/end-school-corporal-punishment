// How two spellings of one school district are compared. Three tools need this and all three have to
// agree, because a rule that is loose in one place and strict in another writes one district's policy
// onto another district's row.
//
// What is dropped is boilerplate: the federal directory says "CHICKASAW CO SCHOOL DIST" where a district
// calls itself "Chickasaw County School District", and neither spelling is more correct.
//
// What is never dropped is "county" and "city". In Alabama, Georgia, Mississippi and Tennessee a county
// district and a city district of the same name are two districts with two boards and, in Talladega's
// case, opposite policies on corporal punishment. kind() keeps them apart, and "co" and "cty" are read
// as county rather than discarded so the abbreviations can meet the full spellings.
const NOISE = /\b(board of education|school district|school dist|public schools|school system|schools|school|public|isd|independent|municipal|sp mun|consolidated|cons|district|dist|sch)\b/g;

export const norm = s => String(s || "").toLowerCase()
  .replace(/\(.*\)/g, " ")
  .replace(/\bct?y\.?\b|\bco\.?\b/g, "county")
  .replace(NOISE, " ")
  .replace(/[^a-z0-9 ]/g, " ")
  .replace(/\s+/g, " ").trim();

export const kind = s => {
  const t = String(s || "").toLowerCase();
  return /\bcount(y|ies)\b|\bct?y\.?\b|\bco\.?\b/.test(t) ? "county" : /\bcity\b/.test(t) ? "city" : null;
};

// Same district, as far as a name can tell. Never enough on its own to overwrite a record: an NCES id
// has to agree too, or the match has to be the only one in the state.
export const sameName = (a, b) => norm(a) === norm(b) && kind(a) === kind(b);
