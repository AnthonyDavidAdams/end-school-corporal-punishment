# Outbound to districts

This is the project writing to a school district about the district's own record: the board policy we
have on file for it, quoted and linked, and the district's own figure from the federal Civil Rights
Data Collection. One message per district, assembled from verified fields, sent to the district's
published address.

It is a notice and a correction request, not a campaign. The difference is not cosmetic:

- **Every factual sentence comes from a field, not from a model.** `tools/outreach/assemble.mjs` fills
  slots from `data/districts/<XX>.yaml`, `data/states/<XX>.yaml` and `data/crdc/`. There is no step in
  which a language model writes a claim about a district. If a field is missing, the sentence that
  needed it is omitted and the district is listed as incomplete, rather than the gap being filled in.
- **We tell them what we publish and ask them to correct it.** The record is public either way. A
  district that has changed its policy since we read it, or that we have read wrong, gets the fastest
  possible route to fixing it, and that route is also how the record gets better.
- **One message.** No sequence, no follow-up cadence, no opens or click tracking. Every message carries
  a real reply-to that a person reads and a one-line way to be removed.
- **Nothing goes to a person's inbox by name.** The address is the district's published general or
  board address. Individual board members are a different piece of work with different rules; see
  `../crm/README.md`, and note that the rule there against sending on a volunteer's behalf is about
  volunteers, not about this.

## What a district is told

1. The policy we hold for it: code, verbatim quote, source URL, and the date someone opened it.
2. Its own number of students struck in 2023-24, where the federal file names it. Where the file does
   not name the district, nothing is claimed — absent from that file means either "reported none" or
   "reported nothing", and the public-use file does not distinguish them.
3. What state law does and does not require, quoting the statute cite from `data/states/`.
4. The link to the district's page in the public record, and how to correct it.

## Running it

```
node tools/outreach/assemble.mjs              # writes outreach/outbox/<XX>/<slug>.md, reports gaps
node tools/outreach/assemble.mjs --state MS   # one state
node tools/outreach/send.mjs --dry-run        # what would go where
node tools/outreach/send.mjs --confirm        # actually sends; refuses without it
```

The outbox is committed. What was sent, and when, is recorded in `outreach/sent.csv`, so the next
person can see what a district has already heard.
