#!/usr/bin/env python3
"""Dead-man alert for the outreach engine.

Every completed cycle ends with a line "HH:MM:SS ops page rebuilt" in out/outreach/<YYYY-MM-DD>.log. If the
newest such line anywhere is older than two hours, something is wrong (a hung socket, a dead host, a job that
was never loaded) and Anthony gets one message through notify.py, then nothing more for six hours unless it
keeps being wrong. On 2026-10-19 a cycle hung on an IMAP socket and nothing ran for seven days with no alert;
this is the alert.

Runs on the always-on host from the scheduler every 30 minutes, and can run anywhere else that has the repo
(the laptop, a Claude scheduled task) as a second pair of eyes on the host itself: if the scheduler is dead,
its own dead-man check is dead with it.

    python3 deploy/always-on/deadman.py                 check, alert if stale (respecting the throttle)
    python3 deploy/always-on/deadman.py --dry-run       check, print the verdict, send nothing, write nothing
    options: --root <repo> (default: the repo this file is in, or $ESCP_REPO)
             --max-age-hours 2   --throttle-hours 6
             --state <file>      where the last alert time is kept (default out/outreach/deadman-state.json)
Exit code 0 when the last cycle is fresh, 2 when it is stale, 3 when no log has ever recorded a cycle.
"""
import argparse
import datetime
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
LINE = re.compile(r"^(\d\d):(\d\d):(\d\d) ops page rebuilt")


def last_completed_cycle(root):
    """The newest 'ops page rebuilt' timestamp across the day logs, scanning newest file first."""
    logs = sorted(glob.glob(os.path.join(root, "out/outreach", "20[0-9][0-9]-[0-9][0-9]-[0-9][0-9].log")), reverse=True)
    for path in logs:
        day = os.path.basename(path)[:10]
        last = None
        try:
            for l in open(path, errors="ignore"):
                m = LINE.match(l)
                if m: last = m.groups()
        except OSError:
            continue
        if last:
            h, mi, s = (int(x) for x in last)
            return datetime.datetime.fromisoformat(day).replace(hour=h, minute=mi, second=s), path
    return None, None


def load_state(path):
    try: return json.load(open(path))
    except Exception: return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.environ.get("ESCP_REPO") or os.path.dirname(os.path.dirname(HERE)))
    ap.add_argument("--max-age-hours", type=float, default=2.0)
    ap.add_argument("--throttle-hours", type=float, default=6.0)
    ap.add_argument("--state", default=None)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    state_path = a.state or os.path.join(root, "out/outreach/deadman-state.json")
    now = datetime.datetime.now()
    last, path = last_completed_cycle(root)
    host = os.environ.get("RAILWAY_SERVICE_NAME") or os.uname().nodename
    if last is None:
        age = None; stale = True
        text = f"Safe Schools engine ({host}): no completed cycle found in any log under {os.path.join(root, 'out/outreach')}. Is the scheduler running and is the repository on the volume?"
    else:
        age = now - last; stale = age > datetime.timedelta(hours=a.max_age_hours)
        text = (f"Safe Schools engine ({host}): no completed cycle for {age.total_seconds() / 3600:.1f} hours. "
                f"Last 'ops page rebuilt' was {last:%Y-%m-%d %H:%M} in {os.path.relpath(path, root)}. "
                f"Check the host's logs (railway logs --deployment) and the IMAP socket first.")
    verdict = "STALE" if stale else "ok"
    print(f"deadman {now:%Y-%m-%d %H:%M}: {verdict}; last completed cycle {last:%Y-%m-%d %H:%M:%S} ({age.total_seconds() / 3600:.1f} h ago)" if last else f"deadman {now:%Y-%m-%d %H:%M}: {verdict}; no cycle ever recorded")
    if not stale:
        return 0
    state = load_state(state_path)
    last_alert = state.get("last_alert")
    throttled = False
    if last_alert:
        try: throttled = now - datetime.datetime.fromisoformat(last_alert) < datetime.timedelta(hours=a.throttle_hours)
        except ValueError: throttled = False
    if a.dry_run:
        print(f"[dry-run] {'throttled (last alert ' + last_alert + ')' if throttled else 'would alert'}:")
        import notify
        notify.send(text, dry_run=True)
        return 2 if last else 3
    if throttled:
        print(f"alert throttled; last sent {last_alert}")
        return 2 if last else 3
    import notify
    how = notify.send(text, subject="[Safe Schools] engine stale")
    print(f"alert sent via {how}")
    try:
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
        json.dump({"last_alert": now.isoformat(timespec="seconds"), "via": how, "age_hours": age.total_seconds() / 3600 if age else None}, open(state_path, "w"))
    except OSError as ex:
        print(f"could not write {state_path}: {ex}", file=sys.stderr)
    return 2 if last else 3


if __name__ == "__main__":
    sys.exit(main())
