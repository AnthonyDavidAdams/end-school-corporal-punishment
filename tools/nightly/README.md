# The nightly run

One slice of the worklist a night, unattended: scan, verify, merge, publish.

```sh
cp tools/nightly/com.earthpilot.escp-nightly.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.earthpilot.escp-nightly.plist
```

It writes to `out/nightly/<date>/` — the slice it took, the raw findings, the verification log, a copy
of the record as it was before the merge, and a `summary.txt` worth reading in the morning.

## What it will and will not do on its own

A model is never the last thing between a finding and the public record. The scan is the only step
that uses one. Verification, merging and the audit are the same deterministic code that has caught
every mistake so far, and any of them failing stops the night with the record uncommitted:

- a quote that is not in its live source is not merged, it is written to `found.failed.json`
- a merge that loses a pre-existing record fails the audit and nothing is committed or deployed
- a record that fails schema validation does the same

So the worst realistic outcome of an unattended night is that nothing happens and the log says why.

## Settings

| Variable | Default | |
|---|---|---|
| `ESCP_NIGHTLY_SLICE` | 120 | districts per night |
| `~/.escp-deploy.env` | — | `DEPLOY_PASS`, `DEPLOY_HOST`, `DEPLOY_PATH`; without it the run commits and pushes but does not deploy |
| `~/.proxies.env` | — | set on the server, not read here |

120 a night finishes the districts that reported striking a child in about six nights. The agent cap
allows roughly 250 districts in one workflow, so this has headroom.

## When it stops being useful

When `worklist.unchecked` reaches zero the run exits without doing anything. That is the point to
re-aim it at the wider target: the 5,786 districts in states that still permit corporal punishment,
most of which never appear in the federal count because they did not report using it.
