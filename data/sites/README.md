# The district web index

Where each school district actually publishes, and every policy document found there.

This exists because the federal directory's addresses decay and nothing refreshes them. The CCD LEA
file is the 2023-24 release and there is no newer one, so districts that changed domain — or that
still carry a 2010-era `~username/cms/` path — are listed at addresses that answer nothing. Of 365
districts checked, 169 answered, 112 served a stub or a bot challenge, and 74 were simply dead.

It also outlasts the question that produced it. Knowing where a district publishes its rules is the
hard half; once known, it answers any policy question asked later — phone policy, AI policy,
restraint, dress code, attendance — not only corporal punishment.

## What a row holds

| field | meaning |
|---|---|
| `name`, `state`, `nces_id`, `county` | from the federal LEA directory, which is the identity of record |
| `listed_website` | the address the government lists |
| `live_website` | the address that actually answers |
| `website_confidence` | how sure the match is, where it came from a search |
| `website_found_by` | `federal directory` when the listed address worked, `search, ranked` when it did not |
| `read_from_archive` | the Wayback snapshot used, where the district's own server refused |
| `documents[]` | `url`, `title`, `relevance`, and `vendor`/`vendor_id` where it is a policy system |

## How it was built

Addresses that answered were walked directly. Addresses that did not were searched, and every result
ranked by whether it is the district's own site rather than a ratings page, a news story, a single
campus or a neighbouring district — the district's own site is frequently not the first result, so
taking the top hit would have pointed a good many rows at U.S. News.

On each site, every link is scored for whether it is or leads to a student handbook, code of conduct
or board policy manual, and everything above the bar is followed. Not the first forty-five links: a
page's links are not ordered by relevance, and truncating cost McComb its handbook until it was fixed.

Ranking cost $0.02 for 196 addresses and $0.38 for 169 site walks.

## Vendor rows are the strongest

A row whose document carries a `vendor` and `vendor_id` was found because the district links its own
manual — `simbli.eboardsolutions.com/...S=4129` on Pierce County's own website. That is the district
asserting the manual is theirs. It is strictly better evidence than matching a district's name inside
a manual against a federal list and hoping the name is unique, which is how 34 districts had to be
dropped from an earlier pass: "Jackson County" exists in a dozen states and a vendor's manual never
says which one it belongs to.

45 Simbli, 18 TASB and 7 BoardDocs manuals are located this way, and each can be read with the
vendor's own reader rather than crawled.

## Regenerate

```sh
node tools/tasb/find-live-site.mjs   --in data/handbooks/stale.json   # needs BRAVE_API_KEY
node tools/tasb/harvest-site.mjs     --in data/handbooks/live.json    # needs OPENROUTER_API_KEY
node tools/tasb/build-site-index.mjs
```

`documents[].relevance` is a calibrated probability, not a score to be read as a percentage of
anything. Low values mean the link was plausible and unconfirmed, and a document nobody has opened
establishes nothing on its own.
