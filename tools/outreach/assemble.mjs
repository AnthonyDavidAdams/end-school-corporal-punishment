// Assembles one message per district from verified fields. No sentence in the output was written by a
// model about a district: every district-specific string is a field from data/districts, data/states or
// the federal count, and a slot with no field behind it drops the sentence that needed it rather than
// being filled in.
//
// Usage: node tools/outreach/assemble.mjs [--state XX] [--min-students N]
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const onlyState = arg("--state", null);
const minStudents = Number(arg("--min-students", 0));

const SITE = "https://earthpilot.org/kids";
const REPLY_TO = "kids@earthpilot.org";
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// National context, so a district's own number can be put beside it. Both figures come from the same
// computation over the same file; see data/crdc/2023-24/SOURCE.md.
const NATIONAL = { students: 19851, districts: 832, year: "2023-24" };

const states = {};
for (const f of readdirSync(join(root, "data/states")).filter(f => f.endsWith(".yaml")))
  { const s = parse(readFileSync(join(root, "data/states", f), "utf8")); states[s.code] = s; }

const STATUS_LINE = {
  allows: d => `permits corporal punishment`,
  consent_required: d => `permits corporal punishment with parental permission`,
  bans: d => `prohibits corporal punishment`,
};

let written = 0; const gaps = [];
for (const f of readdirSync(join(root, "data/districts")).filter(f => f.endsWith(".yaml"))) {
  const doc = parse(readFileSync(join(root, "data/districts", f), "utf8"));
  if (onlyState && doc.state !== onlyState) continue;
  const st = states[doc.state];
  for (const d of doc.districts) {
    // Nothing is sent about a district nobody has opened the policy for.
    if (!d.source || !d.quote || !STATUS_LINE[d.status]) continue;
    if ((d.crdc_students_latest ?? 0) < minStudents) continue;
    const to = d.contact?.district_email || d.contact?.board_email || null;
    if (!to) { gaps.push(`${doc.state} ${d.name}: no published address on file`); continue; }

    const own = d.crdc_students_latest;
    const lines = [];
    const slug = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const certUrl = `${SITE}/stopped/${doc.state.toLowerCase()}-${slug(d.name)}/`;

    // A district that prohibits corporal punishment gets a different letter entirely. It is the only
    // good news this project has, the certificate is the reason to open the message, and the ask is a
    // testimonial -- because the argument that moves a board is not ours, it is another board's.
    if (d.status === "bans") {
      const acted = d.policy_revised || d.policy_adopted || null;
      lines.push(`Dear ${d.name},`, "");
      lines.push(`We keep a public record of which school districts in the United States still permit corporal punishment. Yours does not, and we have made you a certificate saying so: ${certUrl}`, "");
      lines.push(`**What it says**`, "");
      lines.push(`${d.name}${d.policy_code && d.policy_code.length <= 16 ? `, policy ${d.policy_code}` : ""}: prohibits corporal punishment.${acted ? ` Board acted ${acted}.` : ""}`);
      lines.push(`Read on ${d.last_verified} at ${d.source}`, "");
      lines.push(`> ${d.quote.trim()}`, "");
      if (own) lines.push(`In the ${NATIONAL.year} Civil Rights Data Collection your district reported ${own.toLocaleString()} student${own === 1 ? "" : "s"} struck. Whatever the number was then, the policy above is what governs now.`, "");
      lines.push(`It is yours to print, post or send on. If anything on it is wrong, tell us and we will correct the public record and say when we did.`, "");
      lines.push(`**The favour we would ask**`, "");
      lines.push(`${NATIONAL.districts.toLocaleString()} districts told the federal government they struck a student in ${NATIONAL.year}. The argument that moves a school board is not ours. It is another school board's, saying what happened after they stopped: what the staff thought, what discipline looks like now, whether the fears people had came true.`, "");
      lines.push(`If someone at your district would spend ten minutes on that, we would publish it beside the record for the boards still deciding. Three ways, whichever is least trouble:`, "");
      lines.push(`- Reply to this message with a few sentences.`);
      lines.push(`- A short video or voice memo, however it was recorded.`);
      lines.push(`- A ten-minute call at a time you pick.`, "");
      lines.push(`We would publish it at ${SITE}/stopped/ with the name and role of whoever said it, and nothing else. We would send you the page before it goes up, and take it down on a one-line request afterwards, with no argument. If the answer is no, the certificate still stands.`, "");
      lines.push(`— The End School Corporal Punishment project, EarthPilot`, `${SITE} · ${REPLY_TO}`, "");
      lines.push(`Sent once to your published address. Reply "remove" and we will not write again.`);

      const dir = join(root, "outreach/outbox", doc.state);
      mkdirSync(dir, { recursive: true });
      const front = ["---", `to: ${to}`, `subject: "${d.name.replace(/"/g, "'")}: a certificate, and a question"`,
        `state: ${doc.state}`, `district: "${d.name.replace(/"/g, "'")}"`, `kind: recognition`,
        `certificate: ${certUrl}`, `nces_id: ${d.nces_id ? `"${d.nces_id}"` : "null"}`,
        `source: ${d.source}`, `last_verified: ${d.last_verified}`, `reply_to: ${REPLY_TO}`, "---", ""].join("\n");
      writeFileSync(join(dir, `${slug(d.name)}.md`), front + lines.join("\n") + "\n");
      written++;
      continue;
    }

    lines.push(`Dear ${d.name},`, "");
    lines.push(`We keep a public record of which school districts still permit corporal punishment, district by district and with the policy text attached. This message is the entry we hold for yours, so that you can check it and correct it if we have it wrong.`, "");
    lines.push(`**What we have on file**`, "");
    // policy_code holds a real code on most records ("FO(LOCAL)", "JDB") and a prose description of
    // where the text sits on the rest ("Code of Student Conduct 2026-2027, section ... (unnumbered)").
    // Only the first kind reads as a citation; the second is given as a location instead.
    const isCode = d.policy_code && d.policy_code.length <= 16 && !/\s(of|section|policy|handbook)\s/i.test(d.policy_code);
    lines.push(`${d.name}${isCode ? `, policy ${d.policy_code}` : ""}: ${STATUS_LINE[d.status](d)}.`);
    if (d.policy_code && !isCode) lines.push(`Found in: ${d.policy_code}`);
    lines.push(`Read on ${d.last_verified} at ${d.source}`, "");
    lines.push(`> ${d.quote.trim()}`, "");
    if (own !== null && own !== undefined) {
      lines.push(`**Your own number**`, "");
      lines.push(`In the ${NATIONAL.year} Civil Rights Data Collection, which your district filed with the U.S. Department of Education, ${d.name} reported ${own.toLocaleString()} student${own === 1 ? "" : "s"} struck. Nationally the same collection names ${NATIONAL.districts.toLocaleString()} districts and ${NATIONAL.students.toLocaleString()} students. The file is public at https://civilrightsdata.ed.gov and our arithmetic is published at ${SITE}/data/.`, "");
    }
    if (st) {
      lines.push(`**What ${st.name} law requires**`, "");
      const limits = (st.limits || []).map(l => `- ${l}`);
      lines.push(`${st.status === "legal" ? `${st.name} law permits corporal punishment in public schools; it does not require any district to use it.` : `${st.name} law prohibits corporal punishment in public schools.`}${st.statute ? ` (${st.statute}${st.statute_url ? `, ${st.statute_url}` : ""})` : ""}`);
      if (limits.length) lines.push("", ...limits);
      lines.push("");
    }
    lines.push(`**If this is wrong**`, "");
    lines.push(`Reply to this message and tell us what the current policy is, with a link or an attachment, and we will correct the record and say when it was corrected. If the policy has changed since ${d.last_verified}, that is a change we want to publish. Your district's page is ${SITE}/state/${doc.state.toLowerCase()}/.`, "");
    lines.push(`— The End School Corporal Punishment project, EarthPilot`, `${SITE} · ${REPLY_TO}`, "");
    lines.push(`Sent once to your published address. Reply "remove" and we will not write again; the public record stays either way, and correcting it is the only thing we are asking for.`);

    const dir = join(root, "outreach/outbox", doc.state);
    mkdirSync(dir, { recursive: true });
    const front = [
      "---",
      `to: ${to}`,
      `subject: "Corporal punishment policy on file for ${d.name.replace(/"/g, "'")}"`,
      `state: ${doc.state}`,
      `district: "${d.name.replace(/"/g, "'")}"`,
      `kind: notice`,
      `nces_id: ${d.nces_id ? `"${d.nces_id}"` : "null"}`,
      `status: ${d.status}`,
      `policy_code: ${d.policy_code ? `"${d.policy_code}"` : "null"}`,
      `source: ${d.source}`,
      `last_verified: ${d.last_verified}`,
      `crdc_students_latest: ${own ?? "null"}`,
      `reply_to: ${REPLY_TO}`,
      "---",
      ""
    ].join("\n");
    writeFileSync(join(dir, `${slug(d.name)}.md`), front + lines.join("\n") + "\n");
    written++;
  }
}
console.log(`assembled ${written} message${written === 1 ? "" : "s"}`);
if (gaps.length) { console.log(`\n${gaps.length} district${gaps.length === 1 ? "" : "s"} ready except for an address:`); for (const g of gaps.slice(0, 40)) console.log(`  ${g}`); if (gaps.length > 40) console.log(`  ... and ${gaps.length - 40} more`); }
