# Runbook: moving the engine to an always-on host

Ten minutes of clicking and typing if the secrets are ready. Nothing in this directory is deployed yet; no
service exists; no credential has been copied. Read INVENTORY.md first if any step below is surprising.

What goes up: one Railway service built from `deploy/always-on/Dockerfile`, a volume at `/data`, and
`scheduler.py` running the cycle every 15 minutes, the nightly at 02:00 America/Chicago, the game score at
07:00, the recap at 08:30, and the dead-man check every 30 minutes. The repository is cloned onto the volume
at first boot and fast-forwarded from `origin/main` before each cycle; the image is only the runtime.

## 0. Before touching Railway

1. The breach rotation (`~/railway-breach-2026-10/RUNBOOK.md`) says one key per project. Make or pick
   these, fresh, for this service; none of them should be a key that was on Railway before 2026-10-21:
   - `OPENROUTER_API_KEY` for this engine alone (suggested name `rw-escp-engine-2026-10`), with a spend cap
     on the OpenRouter side (see INVENTORY.md §5: tens of dollars a month at the current pace).
   - `IMAP_PASSWORD`: a Gmail app password for `IMAP_USER` made for this host, so it can be revoked alone.
   - `GITHUB_TOKEN`: a fine-grained personal access token scoped to the one repository
     `AnthonyDavidAdams/end-school-corporal-punishment`, permission Contents: read and write, nothing else.
   - `BRAVE_API_KEY`, `DEPLOY_PASS`/`DEPLOY_HOST`/`DEPLOY_PATH`/`COACH_SALT`, `ESCP_MAINTAINER_TOKEN`: the
     rotated values of the same names.
2. On the laptop, commit and push what the host must run. The working tree has uncommitted changes in
   `tools/outreach/run.py`, `writer.py`, `messages.py`, `tools/ops-page.py`, `tools/publish.sh`,
   `tools/certificates/*`, `tools/kit/build.sh`, `data/game/*` and more. The host runs `origin/main`.
   ```sh
   cd ~/end-school-corporal-punishment && git status --short
   git add <the tools and data files you mean> && git commit -m "..." && git push origin main
   ```
3. Stop the laptop's cycle now, before the host ever runs one. Two cycles against two copies of
   `requests.json` would send the same pending requests twice. (The nightly and recap stay loaded until step 6.)
   ```sh
   launchctl unload ~/Library/LaunchAgents/com.earthpilot.escp-outreach.plist
   bash tools/publish.sh "State before the always-on move"     # pushes requests.json and the record
   ```

## 1. Create the service

Railway dashboard → the project that holds the crew server (or a new project `escp-engine`) → New →
GitHub repo → `AnthonyDavidAdams/end-school-corporal-punishment`, branch `main`. Then in the service:

- Settings → Config-as-code → file path `deploy/always-on/railway.toml` (this sets the Dockerfile path and
  the watch patterns so data pushes do not rebuild the image).
- Settings → Volumes → add a volume, mount path `/data`, 5 GB (the clone is about 650 MB, the correspondence
  and logs 40 MB, room for `out/`).
- Do not deploy with `railway up` from the laptop: the working tree carries 3 GB of gitignored files and the
  upload is dropped silently. GitHub-connected deploys build from the repository.

## 2. Variables (names only; the values come from step 0)

Required, the container refuses to start without them:

| Variable | Used by |
|---|---|
| `IMAP_USER` | Gmail address the requests go from (the cycle, notify.py) |
| `IMAP_PASSWORD` | its app password |
| `OPENROUTER_API_KEY` | Jev, the writer, compliments, leads, the nightly classify, the `claude` shim |
| `GITHUB_TOKEN` | `git push` of data and site commits |

Recommended:

| Variable | Without it |
|---|---|
| `BRAVE_API_KEY` | website re-checks and the nightly document search find nothing |
| `DEPLOY_PASS`, `DEPLOY_HOST`, `DEPLOY_PATH`, `COACH_SALT` | the site and the ops page are committed but not rsynced to DreamHost |
| `ESCP_MAINTAINER_TOKEN` | the crew board does not see the Mothership's passes |
| `SMS_RECIPIENT` | only matters with `ESCP_NOTIFY=imessage`, which cannot work on Linux |
| `ESCP_NOTIFY` | `smtp` (the image default). `webhook` needs `ESCP_NOTIFY_WEBHOOK`; `ESCP_NOTIFY_TO` overrides the email recipient (default: `IMAP_USER`, a note to self) |
| `ESCP_PAUSE` | set to `1` for the first boot: the container comes up, clones, and runs nothing |

Optional: `TZ` (default `America/Chicago`), `ESCP_DAILY_ASKS` (25), `ESCP_NIGHTLY_SLICE` (60),
`ESCP_CYCLE_MINUTES` (15), `ESCP_CYCLE_TIMEOUT` (780), `ESCP_NIGHTLY_AT`/`ESCP_SCORE_AT`/`ESCP_RECAP_AT`,
`ESCP_CLAUDE_SHIM=off` (make `review.py`'s Sunday proposals fail instead of spending), `GIT_AUTHOR_EMAIL`
(default `a@175g.com`), `GIT_AUTHOR_NAME`. Do not set `ESCP_LINK_SECRET` (INVENTORY.md §7.2).

## 3. First boot, paused

Set `ESCP_PAUSE=1`, deploy. In `railway logs --deployment` (the runtime stream; `railway logs` alone is the
build stream) expect:

```
entrypoint: cloning https://github.com/AnthonyDavidAdams/end-school-corporal-punishment.git into /data/repo
entrypoint: <sha> on main; 0 uncommitted paths; node v22.x; python 3.12.x; tz America/Chicago
... scheduler: up; repo /data/repo; tz America/Chicago; jobs: cycle every 15m, nightly@02:00, score@07:00, recap@08:30, deadman every 30m
... scheduler: ESCP_PAUSE=1: running nothing
```

Then move the correspondence and the logs onto the volume (INVENTORY.md §6). From the laptop:

```sh
cd ~/end-school-corporal-punishment
tar czf /tmp/escp-state.tgz data/outreach/replies out/outreach
railway ssh -- sh -c 'cat > /data/escp-state.tgz' < /tmp/escp-state.tgz    # railway CLI 5.x forwards stdin
railway ssh -- sh -c 'cd /data/repo && tar xzf /data/escp-state.tgz && rm /data/escp-state.tgz && ls data/outreach/replies | wc -l'
rm /tmp/escp-state.tgz
```

If `railway ssh` will not take stdin, put the tarball on DreamHost outside the web root
(`sshpass -p "$DEPLOY_PASS" rsync /tmp/escp-state.tgz "$DEPLOY_HOST:escp-state.tgz"`, with the values
sourced from `~/.escp-deploy.env`, never typed) and pull it from inside the container the same way (the
container has `sshpass`, `rsync` and the same variables), then delete it on both ends.

Dry checks from inside the container, none of which send anything:

```sh
railway ssh -- python3 /app/deadman.py --dry-run          # finds the newest 'ops page rebuilt' in the copied logs
railway ssh -- python3 /app/notify.py --dry-run "hello"   # shows the channel and recipient it would use
railway ssh -- sh -c 'cd /data/repo && python3 tools/game/score.py'   # reads only; prints the score line
```

## 4. Run

Remove `ESCP_PAUSE` (or set it to `0`) and redeploy. The first cycle starts at the next quarter hour. In the
runtime log, a clean cycle looks like:

```
scheduler: cycle: start
[cycle] HH:MM:SS send: N sent, M still pending
[cycle] HH:MM:SS inbox: N new replies handled
[cycle] HH:MM:SS bounces: ...            (only when there were any)
[cycle] HH:MM:SS followup: N nudges
[cycle] HH:MM:SS tidy: N messages labelled 'Safe Schools' and archived
[cycle] HH:MM:SS certificates (momentum): ...   (only when a superintendent qualified)
[cycle] HH:MM:SS ops page rebuilt
scheduler: cycle: done rc=0 in NNNs
```

Verify, in this order:

1. `rc=0` and `ops page rebuilt` in the log; `done rc=3` means the 13-minute watchdog fired (INVENTORY.md
   §7.1), `done rc=-15` means the scheduler's own timeout killed it.
2. https://earthpilot.org/kids/ops/ shows "Status as of" within the last 15 minutes (needs `DEPLOY_*`).
3. `railway ssh -- python3 /app/deadman.py` prints `ok` with an age under an hour.
4. If a reply was handled: the log says `reply from [address] for ST District: <kind>` and either
   `replied (<move>)` or `held for Anthony`. If every one says `the writer returned nothing usable`, the
   OpenRouter call is failing; see INVENTORY.md §5 (the `temperature` field) and check the key.
5. If anything was sent: the Gmail Sent folder shows it from `IMAP_USER`; the thread gets the "Safe
   Schools" label.
6. If a document was filed: a commit on GitHub authored from the host ("Records request answered: ...").
7. Gmail may flag the new login location on the first IMAP connection; approve it from the account's
   security page. Railway allows outbound 465/993 on paid plans; `smtp_send` or `imap()` raising a
   connection error in the first seconds of the cycle means the plan or region blocks it.

## 5. First night and morning

- 02:00: `[nightly] === ... nightly (jev) start` through `=== ... nightly done: N recorded`. Expect
  `railway: command not found` once, from step 0a; harmless (redeploy the crew service by hand when
  `crew/tasks/tasks.yaml` changes).
- 07:00: `[score] score 2026-..: ... students covered` and `commit_game: pushed`.
- 08:30: `[recap] out/social/recap-<date>.md` then `osascript shim -> smtp` (the draft arrives as an email
  to `ESCP_NOTIFY_TO`). On a Sunday the review runs first and the `claude` shim makes one OpenRouter call.

## 6. Disarm the laptop (only after step 4 passed)

The outreach plist is already unloaded (step 0.3). After the host's first clean cycle:

```sh
launchctl unload ~/Library/LaunchAgents/com.earthpilot.escp-nightly.plist
launchctl unload ~/Library/LaunchAgents/com.earthpilot.escp-recap.plist
launchctl list | grep escp      # nothing
```

Leave the three plist files in place; they are the rollback. Add a second pair of eyes on the host that
does not live on the host: a Claude scheduled task (or anything) that fetches https://earthpilot.org/kids/ops/
hourly and alerts if "Status as of" is more than two hours old. The host's own dead-man check dies with the
host.

## 7. Rollback

1. Pause the host: set `ESCP_PAUSE=1` and redeploy (or `railway down --yes` if the container is wedged;
   note the volume-wedge pattern in memory: a replacement container cannot mount the disk until the old one
   exits, which is why the scheduler kills its jobs on SIGTERM and exits within 10 s).
2. Push the host's state before anything else runs:
   `railway ssh -- sh -c 'cd /data/repo && bash tools/publish.sh "State before rollback"'`
   and bring the correspondence back the way it went up (step 3, reversed: `tar czf` on the host,
   `railway ssh -- cat /data/escp-state.tgz > /tmp/escp-state.tgz` on the laptop, untar in the repo).
3. On the laptop: `git pull --ff-only origin main`, then
   ```sh
   launchctl load ~/Library/LaunchAgents/com.earthpilot.escp-outreach.plist
   launchctl load ~/Library/LaunchAgents/com.earthpilot.escp-nightly.plist
   launchctl load ~/Library/LaunchAgents/com.earthpilot.escp-recap.plist
   ```
4. Revoke the host's `IMAP_PASSWORD` app password and `GITHUB_TOKEN` if the host is being abandoned.

## 8. Day-two notes

- Code changes: push to `main`; the host pulls before the next cycle. Only changes under
  `deploy/always-on/` or the two lockfiles rebuild the image.
- A dirty tree on the host (a failed publish) blocks `git pull --ff-only`; after three failures in a row
  the scheduler sends one notify. Fix with `railway ssh`, `cd /data/repo`, look at `git status`, then either
  `bash tools/publish.sh "..."` or `git stash`.
- `railway ssh -- sh -c 'cd /data/repo && python3 tools/outreach/run.py status'` for the board;
  `... run.py rehold --dry` and `catchup --dry` work the same as on the laptop.
- The ops page's "recent activity" panel reads `/tmp/escp-outreach.out`, which the scheduler keeps; it
  resets on redeploy, which is fine.
- Costs that are new on the host: the writer and the Sunday proposals on OpenRouter (INVENTORY.md §5),
  the Railway service (a container with Chromium needs about 1 GB of memory at peak during certificates
  and the nightly), the volume.
