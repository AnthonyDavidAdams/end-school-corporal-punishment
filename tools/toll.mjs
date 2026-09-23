// The toll: what the record says is happening to children, in the numbers a command board shows.
//
// Two figures, and the honest distance between them. The reported count is the federal one, self
// reported by districts. There is no published national estimate of the true number, so this does not
// invent one: it states the floor the data supports, names each reason the floor is below the truth,
// and leaves the arithmetic visible. A board that shows an invented multiplier next to a federal
// count teaches the room to distrust both.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const csv = (p) => {
  const [head, ...rows] = readFileSync(join(root, p), "utf8").replace(/\r/g, "").trim().split("\n");
  const cols = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v])));
};

export function toll() {
  // Per-state rows cover only the states reporting at least fifty students; the per-district file
  // covers all 832 and sums to the national figure in the claims registry, so the national totals come
  // from there and the per-state table is used only for the state breakdown. Summing the state table
  // for a national number would quietly drop the nineteen students in the small states.
  const states = csv("data/crdc/2023-24/states.csv");
  const districts = csv("data/crdc/2023-24/districts.csv");
  const summary = JSON.parse(readFileSync(join(root, "site/data/summary.json"), "utf8"));
  const worklist = JSON.parse(readFileSync(join(root, "site/data/worklist.json"), "utf8"));

  const num = (r, k) => Number(r[k] || 0);
  const students = districts.reduce((a, r) => a + num(r, "students"), 0);
  // The instance count exists only in the extract note, because the per-district file carries students
  // and not instances. Read it from there rather than retyping it, and fail loudly if the note is
  // reworded, so this can never silently serve a figure the project no longer stands behind.
  const note = readFileSync(join(root, "data/crdc/2023-24/SOURCE.md"), "utf8");
  const m = note.match(/([\d,]+) instances/);
  if (!m) throw new Error("data/crdc/2023-24/SOURCE.md no longer states an instance count");
  const instances = Number(m[1].replace(/,/g, ""));

  const claimed = JSON.parse(readFileSync(join(root, "site/data/claims.json"), "utf8"))
    .find((c) => c.id === "crdc-national-total-2023-24-computed");
  if (claimed && Number(claimed.figure) !== students) {
    throw new Error(`toll disagrees with the claims registry: ${students} computed, ${claimed.figure} claimed`);
  }
  // New Jersey is a ban state; its 380 students are a filing error this project documented, so the
  // count that can be defended in a room excludes it. Both numbers are shown rather than one.
  const njStudents = districts.filter((r) => r.state === "NJ").reduce((a, r) => a + num(r, "students"), 0);

  return {
    year: "2023-24",
    // What the government was told.
    reported: {
      students,
      instances,
      students_excluding_known_error: students - njStudents,
      states_with_any: new Set(districts.filter((r) => num(r, "students") > 0).map((r) => r.state)).size,
      by_state: states.map((r) => ({ state: r.state, students: num(r, "students"), instances: num(r, "instances") })),
      districts: worklist.total_districts_in_federal_count,
    },
    // Why the floor is a floor. Each line is a claim in the registry, not an opinion.
    floor: {
      headline: "at least",
      value: instances,
      basis: "recorded instances, 2023-24",
      reasons: [
        { text: "The Department of Education calls its own count “likely underreported.”", claim: "crdc-undercount-caveat" },
        { text: "It counts students once a year, not the number of times each child was hit.", claim: "crdc-undercount-caveat" },
        { text: "Virtual schools are skipped, and districts file the number themselves with nobody checking it.", claim: "crdc-undercount-caveat" },
        { text: "No federal or academic estimate of the true national figure has ever been published.", claim: null },
      ],
    },
    // The shape of the work.
    record: {
      districts_sourced: summary.districts_sourced,
      districts_recorded: summary.districts_recorded,
      states_prohibiting: summary.states.banned,
      states_permitting: summary.states.legal,
      unchecked_districts: worklist.unchecked,
      children_in_unchecked: worklist.students_in_unchecked,
    },
    generated: summary.generated,
    source: "US Department of Education, Civil Rights Data Collection 2023-24, computed by this project; see data/crdc/2023-24/SOURCE.md",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = toll();
  writeFileSync(join(root, "site/data/toll.json"), JSON.stringify(t, null, 1) + "\n");
  console.log(`toll: ${t.reported.students.toLocaleString()} students, ${t.reported.instances.toLocaleString()} instances, ${t.record.unchecked_districts} districts unchecked`);
}
