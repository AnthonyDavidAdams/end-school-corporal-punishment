# Press list for permitting states

Education reporters, desks, and newsrooms in the 17 states where school corporal punishment is still legal, for pitching when a district ends the practice. States come from `data/game/score.json` (`permitting_states_by_exposure`); local outlets cover the top-12 targets in `data/game/next-targets.json` (`ranked[0..11]`).

## Files

- `press-list.jsonl`: one JSON object per contact (180 lines).
- `blocked.jsonl`: outlets we wanted but could not read in this session (32 lines, no name/email/form; retry by hand). Same keys; `note` says what blocked us.

## Keys

`state`, `outlet`, `outlet_url`, `name` (or null), `role`, `beat`, `email` (or null), `form_url` (or null), `kind` (reporter | desk | newsroom | tips_form), `covers` (list of district ids / county names from next-targets, or `["state"]`), `source_url` (the page where the contact was seen), `checked` (ISO date), `note` (optional).

## Rules used to build it

1. An email or form URL is recorded only if it was actually seen on the outlet's own site or the reporter's own byline/staff page during the session (2026-10-26). Nothing is guessed or pattern-constructed; if an address was not seen, `email` is null even when the name is confirmed.
2. Every contact carries the `source_url` where it was seen. Third-party directories (Muck Rack, RocketReach, LinkedIn) were never used as the source of an address.
3. Where only a generic newsroom address or tips form was found, `kind` is `newsroom` or `tips_form` and says so.
4. Sites that blocked fetching (Gannett, McClatchy, Lee/TollBit, States Newsroom 403s, Cloudflare email obfuscation) were noted and skipped, not circumvented. Those outlets are in `blocked.jsonl`.
5. Stale evidence (old bylines, no 2025-26 stories) is flagged in `note`.
6. Research used WebSearch/WebFetch only; nothing was sent, no forms were filled, no paid API was used.

## Counts per state

| State | Contacts | Named reporters | Generic (desk/newsroom/tips) | With email | Blocked outlets |
|---|---|---|---|---|---|
| TX | 13 | 12 | 1 | 10 | 1 |
| GA | 28 | 20 | 8 | 20 | 5 |
| AL | 10 | 2 | 8 | 5 | 4 |
| MS | 7 | 4 | 3 | 4 | 2 |
| TN | 15 | 8 | 7 | 11 | 0 |
| AR | 15 | 6 | 9 | 13 | 0 |
| OK | 9 | 7 | 2 | 6 | 1 |
| LA | 8 | 7 | 1 | 6 | 1 |
| MO | 9 | 6 | 3 | 6 | 1 |
| IN | 9 | 6 | 3 | 7 | 1 |
| FL | 15 | 12 | 3 | 9 | 2 |
| KS | 6 | 5 | 1 | 6 | 3 |
| NC | 11 | 8 | 3 | 4 | 5 |
| KY | 7 | 3 | 4 | 4 | 0 |
| AZ | 5 | 1 | 4 | 4 | 2 |
| SC | 5 | 3 | 2 | 5 | 2 |
| WY | 8 | 4 | 4 | 8 | 2 |
| **Total** | **180** | **114** | **66** | **128** | **32** |

By kind: reporter 114, newsroom 40, tips_form 14, desk 12.

## Top-12 target coverage

| District id | State | District | Local contacts | Outlets |
|---|---|---|---|---|
| 1302610 | GA | Hall County Schools | 3 | Gainesville Times |
| 1303930 | GA | Newton County Schools | 2 | The Covington News |
| 1300840 | GA | Carroll County Schools | 3 | Times-Georgian (Carrollton) |
| 3703780 | NC | Randolph County School System | 2 | Randolph Hub (Asheboro); Randolph Record |
| 1305390 | GA | Walton County | 2 | The Walton Tribune (Monroe) |
| 1301980 | GA | Effingham County | 4 | Effingham Herald (Rincon); The Current (Coastal Georgia) |
| 0503750 | AR | Cabot School District (Lonoke County) | 11 | Arkansas Democrat-Gazette; KATV (Little Rock); Little Rock Public Radio (KUAR); THV11 (Little Rock); The Leader (Jacksonville, AR) |
| 1305370 | GA | Walker County Schools | 2 | Chattanooga Times Free Press; Walker County Messenger (LaFayette) |
| 4010920 | OK | Enid (Garfield County) | 2 | Enid News & Eagle |
| 0102700 | AL | Phenix City (Russell County) | 5 | The Citizen of East Alabama (Phenix Citizen); WRBL News 3 (Columbus GA / Phenix City); WTVM (Columbus GA / Phenix City) |
| 4700900 | TN | Cumberland County | 5 | Crossville Chronicle; WBIR (Knoxville); WVLT (Knoxville) |
| 1303840 | GA | Murray County | 3 | Chatsworth Times; Dalton Daily Citizen |

## Known gaps (as of 2026-10-26)

- Big-chain metro dailies could not be read by the fetcher, so no current education reporter is confirmed at: The Oklahoman, Kansas City Star, Wichita Eagle, Topeka Capital-Journal, San Antonio Express-News, AL.com, Montgomery Advertiser, Tuscaloosa News, Clarion Ledger, Sun Herald, Shreveport Times, NOLA.com, Columbus Ledger-Enquirer, Savannah Morning News, Augusta Chronicle, Macon Telegraph, IndyStar, Miami Herald, Orlando Sentinel, Sun Sentinel, St. Louis Post-Dispatch (2019 evidence only), News & Observer, Charlotte Observer, The State, Greenville News, Arizona Republic, Arizona Daily Star, Casper Star-Tribune, Wyoming Tribune Eagle, Lexington Herald-Leader, Commercial Appeal, Knoxville News Sentinel, Courier-Tribune (Asheboro).
- States Newsroom outlets (Alabama Reflector, Mississippi Today is separate but also 403, Louisiana Illuminator, Tennessee Lookout, Kentucky Lantern, Arkansas Advocate, Missouri Independent, Indiana Capital Chronicle, Florida Phoenix, NC Newsline, SC Daily Gazette, Arizona Mirror, Georgia Recorder, Oklahoma Voice, Kansas Reflector) return 403 to the fetcher; names were confirmed from their RSS feeds where possible, and emails were recorded only where the feed itself carried them (Oklahoma Voice, Kansas Reflector).
- Public radio: no named education reporter confirmed at GPB, WABE, KJZZ, SC Public Radio, Alabama Public Radio, Wyoming Public Media (Aaron Schrank listed but no byline since 2021), Little Rock Public Radio; newsroom addresses recorded instead.
- Cloudflare-obfuscated emails (recorded as null with a form where one exists): EdNC staff, Carolina Public Press, KJZZ, Cronkite News, WBHM, Alabama Daily News, Walton Tribune, Covington News, WPLN (Alexis Marshall).
- Cabot: the Cabot Star-Herald / Lonoke County Democrat no longer publishes online; The Leader (Jacksonville, AR) is the live local paper with a Cabot section, plus Little Rock TV and the Democrat-Gazette.
- Enid has no local TV station; Oklahoma City stations' contact pages were blocked.
- Where a named local reporter is an editor or general-assignment reporter rather than an education reporter, `beat` says so; small county papers rarely have an education beat.

## Hooks noted during research

- KERA (TX) published "Thousands of kids are still getting paddled in Texas schools" on 2026-10-12 (Bill Zeeble; email not found).
- The Beacon (KS/MO) ran a Kansas school-abuse-laws piece on 2026-10-15 (Maria Benevento).
- Chattanooga Times Free Press covered the Walker County-area school board in Oct 2026 (Kailee Shores).

## Refreshing

Re-check `source_url` before each pitch wave; newsroom turnover is high. When an outlet in `blocked.jsonl` is read by hand, move its line into `press-list.jsonl` with the real contact and a new `checked` date.
