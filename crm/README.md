# Decision-maker CRM

Corporal punishment policy is decided by a small, knowable set of people: roughly 5 to 9 school board members per district and the education committees in 15 legislatures. Persuading them is a relationship problem, and it is worth running like one. This directory is the shared, public-record CRM for that work.

## What it is

- `dossiers/<XX>/<body>.yaml`: one file per decision-making body, produced by the `decision-maker-dossier` skill. For each member: role, term, public contact, recorded position on corporal punishment with evidence, their own stated values (quoted), their public affiliations (self-stated), and a log of every contact the project has made.
- `constituents/`: not in this repo. Real people who volunteer to speak are matched to members privately by a maintainer; their names and contact details never enter a public file. The matching rule is below.
- `messages/<XX>/<body>/`: message drafts and what was actually sent, minus personal details, so the next person knows what a member has already heard.
- `../strategy/playbooks/persuasion.md`: the evidence on what moves elected officials and how to frame this issue for each stated value.

## What it is not

It is not an opposition-research file and not a targeting engine. Three rules, enforced at review:

1. **Public record only.** Nothing from private or friends-only accounts, nothing about family, health, finances, or home. If a member would be surprised the public can read it, it does not go in. See `CODE_OF_CONDUCT.md`.
2. **Real constituents, real words.** Every message a board member receives comes from a real person in their district, who signs it and can be called back. Tools may help that person draft, never invent one. No synthetic "community voices", no message sent under a name that did not write it. Beyond being wrong, one exposed fake letter ends a campaign and hands opponents a permanent talking point.
3. **Persuasion, not pressure.** No contact at home, no contacting employers, no coordinated pile-ons. Ten thoughtful letters from parents in the district beat a thousand form emails; the evidence in the persuasion playbook says so.

## The matching rule

A volunteer who lives in the district fills in: address (verified in-district, then discarded), role (parent, teacher, pediatrician, pastor, business owner, former student), and public affiliations they are willing to name (church, employer type, civic organization, school their children attend). A maintainer matches them to board members who publicly state a shared affiliation and asks whether they want to write. The volunteer writes in their own words; the `message-draft` skill offers a structure from the persuasion playbook and the member's own stated values, and the volunteer edits and signs.

## Geography

Board members answer to their own voters. The CRM records each member's seat (at-large or by zone) and the zone's boundaries when published, so constituents are matched to the member who represents them, and so public comment at meetings comes from the seat's own residents. That is the only "geo-targeting" this project does.

## Dossier schema

```yaml
state: MS
body: "Rankin County School District Board of Trustees"
body_type: school_board        # or house_education_committee, senate_education_committee
district_nces_id: "2803720"
official_url: "https://..."
meeting_schedule: "Second Tuesday, 6 pm; public comment sign-up by 5:30 pm"
decisive_votes: 3              # votes needed to pass a policy change
updated: 2026-09-09
members:
  - name: "Jane Doe"
    seat: "District 2"
    role: president
    term_ends: 2027
    official_url: "https://..."
    contact: { email: "jdoe@district.k12.ms.us", phone: "601-555-0100" }   # official, published only
    position_on_cp: open        # supports_ban | opposes_ban | open | unknown
    evidence:
      - date: 2024-03-12
        summary: "Asked superintendent for CP numbers by school (minutes p. 4)"
        url: "https://..."
    values:                      # the member's own words, quoted, with source
      - quote: "My priority is a safe school where teachers can teach."
        url: "https://..."
    public_affiliations:         # self-stated on an official or campaign page only
      - { type: church, name: "First Baptist Church of Brandon", url: "https://..." }
      - { type: profession, name: "Registered nurse", url: "https://..." }
    contact_log:
      - { date: 2026-09-15, by: "parent, District 2 (name withheld)", channel: email, summary: "Shared district CRDC numbers and opt-out letter", response: "none yet" }
```

## Phase 2

A hosted version (private volunteer database, in-district verification, match suggestions, message drafting with the persuasion playbook, contact log, meeting calendar) is specified in `SPEC.md`. The public dossiers stay in this repo either way; the hosted app holds only what cannot be public.
