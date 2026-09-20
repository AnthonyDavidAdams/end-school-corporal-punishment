// Guards the two mistakes this project has actually made: Talladega City's ban written onto Talladega
// County, which permits it, and Coahoma's NCES id landing on Choctaw's record. Run: node tools/lib/district-name.test.mjs
import { norm, kind, sameName } from "./district-name.mjs";
const cases = [
  // The same district, spelled the way the federal files spell it and the way it spells itself.
  ["Biloxi Public Schools", "BILOXI PUBLIC SCHOOL DIST", true],
  ["Jackson Public Schools", "JACKSON PUBLIC SCHOOL DISTRICT", true],
  ["Sunflower County Schools", "SUNFLOWER CTY CONS SCHOOL DISTRICT", true],
  ["Chickasaw County School District", "CHICKASAW CO SCHOOL DIST", true],
  ["Dale County Board of Education (Dale County Schools)", "Dale County", true],
  ["Tishomingo County Schools", "TISHOMINGO CO SP MUN SCH DIST", true],
  ["Laurens County Schools", "Laurens County", true],
  // Two different districts that a careless rule collapses into one.
  ["Talladega City Schools", "Talladega County Schools", false],
  ["Tuscaloosa County School System", "Tuscaloosa City Schools", false],
  ["Alcorn County Schools", "ALCORN SCHOOL DIST", false],
  ["Odessa ISD", "ECTOR COUNTY ISD", false],
  ["Tippah County Schools", "NORTH TIPPAH SCHOOL DIST", false],
  ["Corinth School District", "Alcorn County Schools", false],
];
let failed = 0;
for (const [a, b, want] of cases) {
  const got = sameName(a, b);
  if (got !== want) { failed++; console.error(`FAIL ${a} vs ${b}: got ${got}, want ${want}  [${norm(a)}/${kind(a)} vs ${norm(b)}/${kind(b)}]`); }
}
console.log(failed ? `${failed} of ${cases.length} failed` : `${cases.length} name cases pass`);
process.exit(failed ? 1 : 0);
