# Hosted CRM: specification

Purpose: hold the parts of the decision-maker CRM that cannot be public (volunteer identities, in-district verification, contact history with personal details) and make matching and drafting fast for organizers.

## Users

- **Organizer** (maintainer-approved): sees a district's board dossier, the volunteer pool for that district, match suggestions, the contact log, and the meeting calendar.
- **Volunteer**: signs up with email (magic link), gives address for one-time in-district verification (geocoded to district and seat zone, then the address is deleted and only district + zone kept), role, affiliations they are willing to name, and consent to be matched. Can draft, edit, and send their own message; can withdraw at any time.
- **Public**: nothing. The app has no public pages; public material lives in the repository.

## Data

- `bodies`, `members`: synced from `crm/dossiers/` in the repository (the repo is the source of truth; the app never writes member profiles).
- `volunteers`: id, email, district_nces_id, seat_zone, role, affiliations (self-declared), consent flags, created_at. No address stored after verification.
- `matches`: volunteer_id, member_id, shared_affiliation, status (suggested, accepted, declined, sent).
- `messages`: match_id, draft, final, channel, sent_at, response_summary. The final text minus personal details is exported back to `crm/messages/` by an organizer.
- `meetings`: body_id, date, agenda_url, comment_signup_rule, who_is_speaking.

## Matching

Suggest a volunteer to a member when they share a self-declared affiliation type and name (same church, same profession, same civic club, child at a school in the member's zone), ranked by: lives in the member's seat zone, role weight (parent of current student > teacher > pediatrician > other), and whether the member has already heard from that role. Never auto-send. The volunteer accepts a match, then writes.

## Drafting

The draft assistant takes: the member's stated values (quoted), the district's verified numbers from `facts/` and `data/crdc/`, the volunteer's role and their own story in their own words, and the persuasion playbook. It proposes a structure and one draft. The volunteer edits; the app refuses to send a draft the volunteer has not changed at all, and every message carries the volunteer's real name and a way to reach them.

## Things it will not do

- Import or scrape social media.
- Send anything on a volunteer's behalf without their edit and explicit send.
- Contact members through channels other than official published contact and public meetings.
- Store a volunteer's address after verification.

## Stack (when built)

Next.js, SQLite, magic-link plus trusted-device auth, Railway. Same pattern as the other EarthPilot projects. Umami analytics, admin page with CSV export. Open Graph metadata on the single login page.
