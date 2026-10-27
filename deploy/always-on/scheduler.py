#!/usr/bin/env python3
"""The always-on scheduler: one process, one container, the four jobs the laptop's launchd used to run.

    cycle     tools/outreach/run.py cycle        every 15 minutes, 13-minute hard timeout
    nightly   tools/nightly/run-jev.sh           02:00 America/Chicago
    score     tools/game/score.py                07:00 daily (then commits data/game and pushes)
    recap     tools/social/recap.py              08:30 daily (Sundays it also writes the game review)
    deadman   deploy/always-on/deadman.py        every 30 minutes (alerts when no cycle has completed in 2 h)

Everything logs to stdout with a job prefix so `railway logs --deployment` is the one place to look. The cycle's
output is also appended to /tmp/escp-outreach.out and the nightly's to /tmp/escp-nightly.out, because
tools/ops-page.py reads those two files for the "recent activity" panels on earthpilot.org/kids/ops/.

Before every cycle the repository on the volume is fast-forwarded from origin/main, so a code change pushed
from the laptop is live on the next cycle without an image rebuild, and whatever the laptop pushed to data/
is merged. A pull that cannot fast-forward (a dirty tree the pipeline left behind) is logged, not forced.

SIGTERM: a Railway volume attaches to one container at a time, so the old container must exit promptly or the
new one can never mount the disk. On SIGTERM every running job gets SIGTERM, then SIGKILL after 10 s, and the
scheduler exits. A cycle killed this way is simply re-run at the next quarter hour; run.py holds a file lock
and writes requests.json after every send, so a partial cycle loses nothing.

Settings (environment):
    ESCP_REPO                 the clone on the volume (default /data/repo)
    ESCP_CYCLE_MINUTES        default 15
    ESCP_CYCLE_TIMEOUT        seconds, default 780 (13 minutes)
    ESCP_NIGHTLY_AT           default 02:00    ESCP_SCORE_AT default 07:00    ESCP_RECAP_AT default 08:30
    ESCP_PAUSE                "1" runs nothing (keeps the container up for inspection)
    TZ                        America/Chicago (set in the Dockerfile; the clock below is local time)
"""
import datetime
import os
import signal
import subprocess
import sys
import threading
import time

REPO = os.environ.get("ESCP_REPO", "/data/repo")
HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
MIRROR = {"cycle": "/tmp/escp-outreach.out", "nightly": "/tmp/escp-nightly.out"}
MIRROR_MAX = 2_000_000   # bytes; the ops page reads the last 400 lines, so the file is trimmed, not rotated

def env_int(k, d):
    try: return int(os.environ.get(k) or d)
    except ValueError: return d

def env_time(k, d):
    s = (os.environ.get(k) or d).strip()
    h, m = s.split(":"); return int(h), int(m)

JOBS = [
    {"name": "cycle",   "cmd": [PY, "tools/outreach/run.py", "cycle"], "every": env_int("ESCP_CYCLE_MINUTES", 15), "timeout": env_int("ESCP_CYCLE_TIMEOUT", 13 * 60), "pull": True},
    {"name": "nightly", "cmd": ["zsh", "tools/nightly/run-jev.sh"],     "at": env_time("ESCP_NIGHTLY_AT", "02:00"), "timeout": 4 * 3600},
    {"name": "score",   "cmd": [PY, "tools/game/score.py"],              "at": env_time("ESCP_SCORE_AT", "07:00"), "timeout": 600, "after": "commit_game"},
    {"name": "recap",   "cmd": [PY, "tools/social/recap.py"],            "at": env_time("ESCP_RECAP_AT", "08:30"), "timeout": 1800},
    {"name": "deadman", "cmd": [PY, os.path.join(HERE, "deadman.py"), "--root", REPO], "every": 30, "timeout": 120},
]

stopping = threading.Event()
running = {}            # name -> Popen
lock = threading.Lock()

def log(*a):
    print(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "scheduler:", *a, flush=True)

def run_job(job):
    name = job["name"]
    with lock:
        if name in running:
            log(f"{name}: previous run still going (pid {running[name].pid}); skipped"); return
    if job.get("pull"): git_sync()
    started = time.time(); log(f"{name}: start")
    try:
        p = subprocess.Popen(job["cmd"], cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    except Exception as ex:
        log(f"{name}: could not start: {ex!r}"); return
    with lock: running[name] = p
    mirror = MIRROR.get(name)
    killer = threading.Timer(job["timeout"], lambda: timeout_kill(name, p))
    killer.daemon = True; killer.start()
    mf = None
    try:
        if mirror:
            try:
                if os.path.exists(mirror) and os.path.getsize(mirror) > MIRROR_MAX:
                    tail = open(mirror, errors="ignore").read()[-MIRROR_MAX // 2:]; open(mirror, "w").write(tail)
                mf = open(mirror, "a")
            except Exception: mf = None
        for line in p.stdout:
            sys.stdout.write(f"[{name}] {line}"); sys.stdout.flush()
            if mf:
                mf.write(line); mf.flush()
    finally:
        rc = p.wait(); killer.cancel()
        if mf: mf.close()
        with lock: running.pop(name, None)
    log(f"{name}: done rc={rc} in {time.time() - started:.0f}s")
    if rc == 0 and job.get("after") == "commit_game": commit_game()

def timeout_kill(name, p):
    log(f"{name}: timeout; killing process group")
    try: os.killpg(p.pid, signal.SIGTERM)
    except Exception: pass
    time.sleep(10)
    try: os.killpg(p.pid, signal.SIGKILL)
    except Exception: pass

def sh(args, timeout=120):
    r = subprocess.run(args, cwd=REPO, capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout + r.stderr).strip()

pull_failures = [0]
def git_sync():
    """Fast-forward the clone from origin/main; push anything the pipeline committed but could not push."""
    try:
        rc, out = sh(["git", "pull", "--ff-only", "-q", "origin", "main"], timeout=300)
        if rc == 0:
            pull_failures[0] = 0
        else:
            pull_failures[0] += 1
            log(f"git pull failed ({pull_failures[0]} in a row): {out[-300:]}")
            if pull_failures[0] == 3:
                notify(f"Safe Schools engine: git pull has failed 3 cycles in a row on the always-on host. Last error: {out[-200:]}")
        rc, out = sh(["git", "rev-list", "--count", "origin/main..HEAD"])
        if rc == 0 and out.strip() not in ("", "0"):
            rc2, out2 = sh(["git", "push", "-q", "origin", "main"], timeout=300)
            log("git push: " + ("ok" if rc2 == 0 else out2[-200:]))
    except Exception as ex:
        log(f"git sync error: {ex!r}")

def commit_game():
    """The score history is tracked in git but no pipeline step commits it; this does, once a day."""
    try:
        rc, out = sh(["git", "status", "--porcelain", "--", "data/game"])
        if rc != 0 or not out.strip(): return
        sh(["git", "add", "data/game"])
        day = datetime.date.today().isoformat()
        rc, out = sh(["git", "commit", "-q", "-m", f"Game: score {day}\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"])
        if rc == 0:
            rc, out = sh(["git", "push", "-q", "origin", "main"], timeout=300)
        log("commit_game: " + ("pushed" if rc == 0 else out[-200:]))
    except Exception as ex:
        log(f"commit_game error: {ex!r}")

def notify(text):
    try:
        subprocess.run([PY, os.path.join(HERE, "notify.py"), text], timeout=60)
    except Exception as ex:
        log(f"notify failed: {ex!r}")

def on_term(signum, frame):
    log("SIGTERM: stopping")
    stopping.set()
    with lock: procs = list(running.items())
    for name, p in procs:
        log(f"stopping {name} (pid {p.pid})")
        try: os.killpg(p.pid, signal.SIGTERM)
        except Exception: pass
    deadline = time.time() + 10
    while time.time() < deadline and any(p.poll() is None for _, p in procs): time.sleep(0.2)
    for name, p in procs:
        if p.poll() is None:
            try: os.killpg(p.pid, signal.SIGKILL)
            except Exception: pass
    log("stopped"); os._exit(0)

def main():
    signal.signal(signal.SIGTERM, on_term); signal.signal(signal.SIGINT, on_term)
    if not os.path.isdir(os.path.join(REPO, ".git")):
        log(f"no repository at {REPO}; the entrypoint should have cloned it"); sys.exit(1)
    log(f"up; repo {REPO}; tz {os.environ.get('TZ')}; jobs: " + ", ".join(j["name"] + ("@%02d:%02d" % j["at"] if "at" in j else f" every {j['every']}m") for j in JOBS))
    if os.environ.get("ESCP_PAUSE") == "1":
        log("ESCP_PAUSE=1: running nothing"); signal.pause()
    last_slot = {}          # name -> the slot (minute index or day) it last ran in
    while not stopping.is_set():
        now = datetime.datetime.now()
        for job in JOBS:
            if "every" in job:
                slot = (now.hour * 60 + now.minute) // job["every"]
                key = (now.date(), slot)
                if last_slot.get(job["name"]) != key and now.minute % job["every"] == 0:
                    last_slot[job["name"]] = key
                    threading.Thread(target=run_job, args=(job,), daemon=True).start()
            else:
                h, m = job["at"]
                if (now.hour, now.minute) == (h, m) and last_slot.get(job["name"]) != now.date():
                    last_slot[job["name"]] = now.date()
                    threading.Thread(target=run_job, args=(job,), daemon=True).start()
        time.sleep(60 - now.second + 0.2)

if __name__ == "__main__":
    main()
