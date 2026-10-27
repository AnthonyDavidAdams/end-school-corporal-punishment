# Inventory: every scheduled job of this project on the laptop

Taken 2026-10-26 from `~/Library/LaunchAgents/com.earthpilot.escp-*.plist`, the scripts they run, and the
files those scripts open. Secrets are named by variable, never by value. "Laptop-only" means a thing that
exists on the Mac and not on a Linux host, with the answer the always-on image gives it.

Three launchd jobs exist. The game scripts (`tools/game/*.py`) are not scheduled on their own: `review.py`
runs on Sundays from the recap job, `assign.py`/`ledger.py` run inside the outreach cycle, and `score.py` is
run by hand. The always-on scheduler adds a daily `score.py` run and commits its output.

## 1. `com.earthpilot.escp-outreach` — the cycle, every 15 minutes

| | |
|---|---|
| Command | `cd $HOME/end-school-corporal-punishment && /opt/homebrew/bin/python3 tools/outreach/run.py cycle` (via `/bin/zsh -lc`) |
| Schedule | `StartInterval` 900 s; `RunAtLoad` false |
| Stdout/err | `/tmp/escp-outreach.out`, `/tmp/escp-outreach.err` (the ops page reads the `.out` file for its "recent activity" panel) |
| Own log | `out/outreach/<YYYY-MM-DD>.log`; the last line of a completed cycle is `HH:MM:SS ops page rebuilt` (the dead-man signal) |
| Guard | `fcntl` lock on `data/outreach/requests.json.lock`; `socket.setdefaulttimeout(120)`; SIGALRM watchdog at 13 minutes after the lock is held (exit 3) |
| Last clean cycle | 2026-10-18 21:11. On 10-26 the cycle was killed by the watchdog at 22:59:57 during the follow-up nudges (each nudge sleeps 8 s, 25 sends sleep 8 s each) before reaching the ops page. See "Findings" below. |

Steps, in order (`run.py` `cycle`): `send(25)` → `inbox()` → `bounces()` → `followup()` → `tidy()` →
`tools/certificates/send.py --momentum --limit 20` (run as `tools/.venv/bin/python`) → `ops_page()`
(`tools/ops-page.py`, rsync of `site/ops/` to DreamHost, then `tools/crm.py`).

Reads: `data/outreach/requests.json`; `data/outreach/replies/<id>/*.eml` (gitignored: the raw
correspondence, 33 MB); `data/districts/*.yaml`; `data/contacts/*.json`; `data/crdc/2023-24/districts.csv`;
`data/nces/lea-directory-2023-24.csv`; `site/data/states.json`; `data/game/experiments.yaml`,
`data/game/assignments.json`; `data/outreach/policy-lag.json`; `data/outreach/links.jsonl`; `out/briefs/*.pdf`
and `kit/*.pdf` as attachments. Network: Gmail IMAP (`imap.gmail.com`, folders INBOX, All Mail, Sent Mail,
Drafts, label "Safe Schools"), Gmail SMTP (`smtp.gmail.com:465`), OpenRouter (Jev `typesafe/jev-1.13` on
`/api/alpha/decisions` for triage and the referee; the writer, see §5; `anthropic/claude-haiku-4.5` for the
compliment line; `openai/gpt-5.4-mini` with the web plugin for `writer.leads()`), Brave Search (`recheck.py`),
Google News RSS (`compliment.py`), district websites (fetch and one-hop follow), the crew server
(`escp-mcp-production.up.railway.app`, via `tools/lib/ops.mjs` from `classify.mjs`).

Writes: `requests.json` (after every send and every reply); `data/outreach/replies/<id>/<hash>.eml`;
`data/policies/inbound/<ST>/*` (documents received, tracked in git); `data/districts/<ST>.yaml` (through
`tools/merge-scan.mjs`); `site/**` (through `npm --prefix tools run build-site` inside `tools/publish.sh`);
`site/ops/index.html`, `site/ops/board.html`, `site/ops/crm.html`, `site/data/crm.json`;
`out/outreach/<date>.log`, `out/outreach/inbound-*.json(l)`, `out/outreach/bounce-*.json(l)`;
`data/game/moves.jsonl` (ledger); `out/certificates/sent/*` (certificate HTML/PDF/PNG). Git: `tools/publish.sh`
commits `data/districts data/policies data/outreach/requests.json site` and pushes to `origin main` each time a
document is filed. Deploy: `rsync` of `site/` (publish) and `site/ops/` (every cycle) to DreamHost over
password SSH.

Secrets (laptop file → variable):
- `~/inbox-brief/config.env` → `IMAP_USER`, `IMAP_PASSWORD`, `SMS_RECIPIENT` (also `MY_ADDRESSES`, `ANTHROPIC_API_KEY`, which this project does not use). `run.py` opens this file at import with no existence check.
- `~/personality-bench/.env.local` → `OPENROUTER_API_KEY` (also `OPENROUTER_TITLE`, `OPENROUTER_REFERER`, unused here). `run.jev_key()`, `writer.key()` and `compliment.key()` open it with no existence check; `triage.jev_key()` and `tools/lib/ops.mjs` fall back to the environment.
- `~/.brave.env` → `BRAVE_API_KEY` (recheck of district websites; without it recheck searches nothing).
- `~/.escp-deploy.env` → `DEPLOY_PASS`, `DEPLOY_HOST`, `DEPLOY_PATH`, `COACH_SALT`. `links.py` also looks for `ESCP_LINK_SECRET` here; it is not in the file today, so tagged links are signed with the built-in default. Keep it that way on the host (unset on both) or set the same value on both, or old tokens stop matching.
- `~/.escp-maintainer.env` → `ESCP_MAINTAINER_TOKEN` (ops reports to the crew board; silent without it).
- Git push credential: `gh auth git-credential` / macOS keychain (laptop-only; the host uses `GITHUB_TOKEN`).

Laptop-only pieces and the image's answer:
- `osascript` → iMessage (`text_anthony`, one digest per cycle with replies): `bin/osascript` shim → `notify.py` (`ESCP_NOTIFY=smtp|webhook|imessage`).
- `claude -p` on the Max plan (the writer): `ESCP_WRITER=openrouter` set in the image; see §5.
- `/opt/homebrew/bin/python3`: symlinked in the image (the nightly hardcodes it).
- `tools/.venv/bin/python` (gitignored venv, Python 3.14 with python-docx, qrcode, PyYAML, Pillow): symlink to the system interpreter with the same packages.
- `pdftotext`, `ocrmypdf`, `tesseract` (Homebrew): apt `poppler-utils ocrmypdf tesseract-ocr`.
- `textutil` (macOS, .doc/.docx to text): `bin/textutil` shim (python-docx, antiword).
- `sshpass`, `rsync`, `ssh`: apt.
- Playwright Chromium: `tools/certificates/make.mjs` renders every certificate PDF with it; `tools/contacts/harvest-emails.mjs` (bounce retries) too. Base image `mcr.microsoft.com/playwright:v1.63.0-noble` matches `package-lock.json`.
- Node 25 on the laptop, Node 22 in the image; nothing in the scheduled tools needs 25.

## 2. `com.earthpilot.escp-nightly` — the harvest, 02:00 local

| | |
|---|---|
| Command | `$HOME/end-school-corporal-punishment/tools/nightly/run-jev.sh` (a zsh script, via `/bin/zsh -lc`) |
| Schedule | `StartCalendarInterval` 02:00 |
| Stdout/err | `/tmp/escp-nightly.out`, `/tmp/escp-nightly.err` (the ops page reads the `.out`; it does not exist on the laptop right now) |
| Own log | `out/nightly/<date>/run.log`, plus `slice.json`, `found.jsonl`, `read.jsonl`, `classified.json`, `records.json`, `held.json`, `districts.before/` |
| Last run | `launchctl list` shows exit status -15 (killed) for the last attempt; `out/nightly/2026-10-20/run.log` holds only the start line |

Steps: `run.py queue ${ESCP_DAILY_ASKS:-25}` (tomorrow's asks onto the pending list) → `tools/crew-scopes.mjs`
and, if `crew/tasks/tasks.yaml` changed, `git commit` + `railway up --detach` (redeploys the crew server) →
`tools/portals/nightly.sh` (KY KSBA, IN Neola, NC NCSBA (Playwright), KS KASB (pdftotext), OK (pdftotext,
ocrmypdf, textutil); each classified by Jev, turned into records, merged) → `npm --prefix tools run
build-worklist` → slice of `${ESCP_NIGHTLY_SLICE:-60}` unchecked districts → `tools/tasb/find-document.mjs`
(Brave + Jev) → `tools/tasb/read-found.mjs --workers 4` (fetch; Playwright for walled sites) →
`tools/tasb/classify.mjs` (Jev) → `tools/tasb/records-from-classified.py` → `tools/merge-scan.mjs` →
`fill-county.mjs` + `validate.mjs` (any failure stops the night uncommitted) → `build-site` → `git add
data/districts data/handbooks site && git commit && git push` → rsync `site/` to DreamHost → ops report.

Reads: `site/data/worklist.json`, `data/handbooks/nightly-searched.json` (14-day memory), `data/handbooks/*.jsonl`
(portal harvests, resumable), `data/districts`, `data/crdc`, `data/nces`. Writes: everything under
`out/nightly/<date>/` and `out/portals/<date>/`, `data/handbooks/*`, `data/districts/*.yaml`, `site/**`,
`crew/tasks/tasks.yaml`; commits and pushes; deploys.

Secrets: `OPENROUTER_API_KEY`, `BRAVE_API_KEY`, `DEPLOY_PASS`/`DEPLOY_HOST`/`DEPLOY_PATH`,
`ESCP_MAINTAINER_TOKEN`, git push credential, and the Railway CLI login for step 0a's `railway up`.
Optional: `EGRESS_PROXIES` (`~/.proxies.env`) is read by four node tools when set; the README says it is set
on the server, not here.

Laptop-only: `/opt/homebrew/bin/python3` (hardcoded in step 0; on Linux without the symlink the queue step
silently does nothing), zsh, `railway` CLI (not in the image: step 0a prints "command not found" and moves
on; the commit it makes is pushed by step 3; redeploy the crew service by hand when `tasks.yaml` changes),
Playwright, `pdftotext`/`ocrmypdf`/`textutil`, `sshpass`.

## 3. `com.earthpilot.escp-recap` — the recap, 08:30 local

| | |
|---|---|
| Command | `/opt/homebrew/bin/python3 /Users/anthony/end-school-corporal-punishment/tools/social/recap.py`, `WorkingDirectory` the repo |
| Schedule | `StartCalendarInterval` 08:30 |
| Stdout/err | `out/social/recap.log` (both) |
| Last run | exit 0 |

Reads: `requests.json`, `data/districts/*.yaml`, the three newest `out/outreach/*.log` (for the health line
and reply counts), `out/video/one-sentence/img/*.jpg` (a still to attach). Writes
`out/social/recap-<date>[-weekly].md`. Sundays: runs `tools/game/review.py` first, which recomputes the score
(`data/game/score.json`, `score-history.jsonl`), the experiment report (`data/game/report.md`), the next
targets (`data/game/next-targets.json`), asks `claude -p` for three proposals, and writes
`out/game/review-<date>.md`.

Secrets: `SMS_RECIPIENT` from `~/.escp-outreach.env`, which does not exist on the laptop; the script then
falls back to a number hardcoded in `recap.py`. The entrypoint writes that file from `SMS_RECIPIENT` on the
host; the osascript shim ignores the recipient anyway and routes through `notify.py`.

Laptop-only: `osascript` (text and the still image; the shim drops the image), `claude -p` (`review.py`
has no fallback of its own: the `bin/claude` shim answers it through OpenRouter, one call a week).

## 4. The game scripts (`tools/game/`)

| Script | When | Reads | Writes |
|---|---|---|---|
| `score.py` | by hand today; daily 07:00 on the host | `data/districts/*.yaml`, `data/states/*.yaml`, `data/outreach/policy-lag.json`, `data/nces/lea-enrollment-2023-24.csv` | `data/game/score.json`, `data/game/score-history.jsonl` (tracked in git; no pipeline step commits them: the scheduler commits `data/game` after a successful score run) |
| `assign.py`, `ledger.py` | inside the cycle (`queue`, `send`) | `data/game/experiments.yaml`, `assignments.json` | `assignments.json`, `moves.jsonl`, `outcomes.jsonl` (with a lock) |
| `report.py`, `neighbors.py`, `review.py` | Sundays from the recap | the ledgers, `data/geo/county-adjacency.csv` | `data/game/report.md`, `next-targets.json`, `out/game/review-<date>.md` |

No secrets except `review.py`'s model call. Pure Python plus PyYAML.

## 5. The writer: `claude -p` and the OpenRouter fallback

`tools/outreach/writer.py` writes every reply the cycle sends. `WRITER = "anthropic/claude-fable-5.1"`,
`CLI_MODEL = "claude-fable-5-1"`, `USE_CLI = os.environ.get("ESCP_WRITER", "cli") != "openrouter"`.

- Default (laptop): `ask_cli()` runs `claude -p --model claude-fable-5-1 --output-format text
  --no-session-persistence --system-prompt <brief> --disallowedTools ...` with the situation on stdin,
  240 s timeout, on the Max plan: no per-call charge.
- `ESCP_WRITER=openrouter`: skips the CLI and POSTs the same brief and situation to
  `https://openrouter.ai/api/v1/chat/completions` with `max_tokens 2000`, three attempts, 150 s each.
- Automatic fallback: if the CLI is missing or exits non-zero or prints nothing, `decide()` falls through
  to the OpenRouter call anyway. So the writer works on a host with no `claude` at all; the image sets
  `ESCP_WRITER=openrouter` to skip the failed spawn.
- The referee (`check()`), the triage and the compliment are already on OpenRouter on the laptop; nothing
  changes for them.

What it costs. Anthropic's list price for Claude Fable 5.1, which OpenRouter passes through, is $10 per
million input tokens and $50 per million output tokens; thinking is always on for this model and is billed
as output. The brief is 6,823 characters (about 1,700 tokens) and the situation is the thread (up to ten
messages of 2,200 characters each, typically two to four) plus the record, so a call is roughly 3,000 to
6,000 input tokens ($0.03 to $0.06) and 500 to 2,500 output tokens including thinking ($0.03 to $0.13):
about $0.10 to $0.15 per reply written, $0.20 at the high end. One call per reply handled (bounces and
auto-replies skip it; a held thread still calls it). Volume from the logs: 77, 101, 9, 7, 8 replies on
10-12 through 10-16, 12 on 10-26, zero while the cycle was hung. So roughly $1 to $3 on an ordinary day,
$10 to $20 on a day like 10-13, on the order of $30 to $90 a month at the current pace, plus about $0.30 a
week for the Sunday proposals through the `claude` shim (a larger prompt, one call). Jev, Haiku and
gpt-5.4-mini calls are unchanged and already on the OpenRouter bill.

One thing to verify on the first real reply, because it cannot be tested without spending: the OpenRouter
request body carries `"temperature": 0.2`. Since 2026-10-21 Anthropic's Messages API returns a 400 to any
request that sends `temperature`. OpenRouter normally drops parameters a model does not accept, but if it
passes it through, every `decide()` call fails three times and the cycle holds every reply "for Anthony"
with a Gmail draft (log line `the writer returned nothing usable (...)`). The fix is deleting that one
field in `writer.py`; it is not in this staging commit because `tools/` is not in its scope.

## 6. State that is not in git and has to move to the volume

| Path | Size | Why |
|---|---|---|
| `data/outreach/replies/` | 33 MB | the raw `.eml` of every reply; `thread_of()` reads them so the writer sees the whole thread. Without them, threads begun before the move read as empty on their side. |
| `out/outreach/*.log` | 2 MB | the recap counts replies from the last few days' logs; the dead-man check reads them; the ops page shows them |
| `out/certificates/sent/` | part of 1 GB | past certificate renders; not needed (the sender decides from `requests.json`) |
| `out/briefs/` | small | board briefs attached to align invitations; regenerated on demand by `queue-align` |
| `data/outreach/requests.json.lock` | 0 | ephemeral |

Tracked and cloned automatically: `data/` minus the above (357 MB tracked data and site; `data/documents`,
1.4 GB, is gitignored and published separately, not read by any scheduled job), `.git` 244 MB.

## 7. Findings while taking this inventory

1. The cycle's 13-minute budget is being spent before the ops page. Since the watchdog went in on 10-26
   the only cycle in the log ended with `watchdog: cycle exceeded 13 minutes` after 18 nudges; no `ops page
   rebuilt` line has been written since 10-18. Sends and nudges sleep 8 s each (25 + N), the inbox pass
   fetches every new reply in full, and the certificate step can run for minutes. The dead-man alert would
   fire on this today. Worth a look before or right after the move: cap nudges per cycle, or move `followup()`
   after `ops_page()`.
2. `ESCP_LINK_SECRET` is referenced by `links.py` but absent from `~/.escp-deploy.env`, so tagged links use
   the default secret. Do not set it on the host unless it is also set on the laptop.
3. `recap.py` has a phone number hardcoded as the fallback recipient. Harmless on the host (the shim ignores
   it) but worth removing.
4. `run-jev.sh` step 0 calls `/opt/homebrew/bin/python3` by path; on any non-Homebrew machine the daily
   queue step would fail silently (`| tail -1` swallows the error). The image symlinks the path.
5. `tools/nightly/run.sh` (the older, `claude -p`-driven night) is not scheduled; `run-jev.sh` is. Only the
   latter is moved.
6. The laptop working tree has uncommitted changes to `tools/outreach/run.py`, `writer.py`, `messages.py`,
   `tools/ops-page.py`, `tools/publish.sh`, `tools/certificates/*` and others. The host runs `origin/main`;
   those changes must be committed and pushed before the host's first cycle or it runs older code.
