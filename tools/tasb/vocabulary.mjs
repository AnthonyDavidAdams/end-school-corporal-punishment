// What to search for, and how to notice when the list is wrong.
//
// The terms are not guessed. They are measured from every finding a person has approved: across 311
// verified operative sentences, "corporal punishment" appears in 310. The list below is that corpus,
// ranked, plus the words that separate one status from another. Regenerate it as the record grows and
// it gets better on its own -- which a hand-written list does not.
//
// The interesting 311th is Alcorn School District, Mississippi: "A maximum of three (3) licks may be
// administered for disciplinary purposes only." No "corporal", no "paddle". A closed list cannot find
// that district, and cannot tell you it missed it. That is what the open-set check below is for.

// Anchors: finding any of these in a document means the search worked.
export const ANCHORS = [
  "corporal punishment", "corporal", "paddling", "paddle", "paddled",
  "spanking", "spanked", "swat", "licks",
];

// Words that separate the statuses, measured by their lift toward one status in the verified corpus.
// Used to rank candidate sentences before the expensive step, never to decide by themselves.
export const SIGNALS = {
  bans: ["prohibit", "prohibited", "prohibits", "shall not be", "may not be", "subjected", "eliminated"],
  consent_required: ["consent", "approval", "prior written", "written permission", "opt in", "before administering"],
  allows: ["may be used", "is authorized", "authorizes", "may administer", "in accordance with"],
};

// Things that read like corporal punishment and are not. Restraint is the one that matters: it is a
// safety measure, lawful everywhere, and miscoding it is how a New Jersey district that prohibits
// corporal punishment came to report 380 students struck in the federal collection.
export const NOT_THIS = [
  "physical restraint", "restraint and seclusion", "seclusion", "mechanical restraint",
  "chemical restraint", "self-defense", "imminent bodily harm",
];

// The question to ask when the anchors find nothing. A closed vocabulary cannot report its own gaps;
// a probability can. Measured 2026-09-24: "licks" 0.74, "board of education applied to the buttocks"
// 0.88, "physical discipline before a witness" 0.77, a listed word 0.21, unrelated discipline 0.02,
// and physical restraint 0.03 -- it separates the thing from its most dangerous lookalike.
export function openSetQuestion(terms = ANCHORS) {
  return {
    other_wording: {
      type: "noul",
      instructions: `Our search looks for these words: ${terms.join(", ")}. Does this passage describe a school physically striking a student as punishment using DIFFERENT wording than any of those?`,
      criteria: {
        true: "It describes hitting or striking a student as discipline, using vocabulary not in the list.",
        false: "It either uses one of the listed words, or does not describe physically striking a student at all.",
      },
    },
  };
}

// Above this, a document is worth a person's attention even though the search found nothing: either it
// uses vocabulary we do not know, or it is a lookalike worth ruling out explicitly.
export const NEW_VOCABULARY_THRESHOLD = 0.5;

export const hasAnchor = (text) =>
  ANCHORS.some((t) => new RegExp(t.replace(/\s+/g, "\\s+"), "i").test(text ?? ""));
