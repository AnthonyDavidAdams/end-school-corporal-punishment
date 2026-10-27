"""Daily / weekly project recap for LinkedIn and Facebook. Builds the numbers from the record and the outreach log,
writes out/social/recap-<date>.md (a LinkedIn version and a shorter Facebook version), picks a still from the film,
and texts Anthony the draft so he can post it or say "post".

  python3 tools/social/recap.py            # daily
  python3 tools/social/recap.py --weekly   # the seven-day version
  python3 tools/social/recap.py --no-text  # write the file only"""
import json, os, sys, glob, datetime, subprocess, collections, random
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
OUT = os.path.join(ROOT, "out/social"); os.makedirs(OUT, exist_ok=True)
STILLS = [os.path.join(ROOT, "out/video/one-sentence/img", n) for n in ("paddle.jpg", "hallway.jpg", "classroom.jpg", "boardroom.jpg", "sunrise.jpg", "two_desks.jpg")]
weekly = "--weekly" in sys.argv; days = 7 if weekly else 1
now = datetime.datetime.now(); since = now - datetime.timedelta(days=days)
# Sundays: the game's weekly review (scoreboard, experiments, next targets, proposed variants) is written to
# out/game/review-<date>.md for Anthony. It is not posted or texted anywhere.
if now.weekday() == 6 and "--no-review" not in sys.argv:
    try: subprocess.run([sys.executable, os.path.join(ROOT, "tools/game/review.py")], cwd=ROOT, capture_output=True, text=True, timeout=1200)
    except Exception as ex: print("game review failed", repr(ex)[:120])

def ts(x):
    try: return datetime.datetime.fromisoformat(str(x)[:19])
    except Exception: return None

rs = json.load(open(os.path.join(ROOT, "data/outreach/requests.json")))
rec = collections.Counter()
for f in glob.glob(os.path.join(ROOT, "data/districts/*.yaml")):
    import yaml
    for d in yaml.safe_load(open(f))["districts"]: rec[d.get("status")] += 1
sent = sum(1 for r in rs if ts(r.get("sent_at")) and ts(r["sent_at"]) > since)
# replies are counted from the outreach log, one "reply from" line per inbound message handled
replies = 0
for i in range(days + 1):
    day = (now - datetime.timedelta(days=i)).strftime("%Y-%m-%d"); lf = os.path.join(ROOT, "out/outreach", day + ".log")
    if os.path.exists(lf):
        for l in open(lf, errors="ignore"):
            if "reply from" in l and ts(day + "T" + l[:8]) and ts(day + "T" + l[:8]) > since: replies += 1
certs = sum(1 for r in rs if r.get("kind") in ("certificate", "certificate_state") and r["status"] == "sent" and ts(r.get("sent_at")) and ts(r["sent_at"]) > since)
certs_total = sum(1 for r in rs if r.get("kind") in ("certificate", "certificate_state") and r["status"] == "sent")
replied_total = sum(1 for r in rs if r.get("replies"))
# a recent win: the newest district whose record says bans and who wrote to us
wins = []
for r in rs:
    if r.get("kind") == "certificate" and r["status"] == "sent" and ts(r.get("sent_at")) and ts(r["sent_at"]) > since: wins.append(f"{r['name'].title() if r['name'].isupper() else r['name']}, {r['state']}")
# Health line for Anthony's copy only: the cycle hung for a week in October and nobody noticed for seven days.
last_cycle = None
for lf in sorted(glob.glob(os.path.join(ROOT, "out/outreach/20*.log")))[-3:]:
    for l in open(lf, errors="ignore"):
        if "ops page rebuilt" in l: last_cycle = ts(os.path.basename(lf)[:10] + "T" + l[:8])
stale = (not last_cycle) or (now - last_cycle) > datetime.timedelta(hours=2)
health = f"CYCLE STALE: last completed {last_cycle:%Y-%m-%d %H:%M}" if (stale and last_cycle) else ("CYCLE STALE: none found" if stale else f"cycle ok, last {last_cycle:%H:%M}")
period = "this week" if weekly else "today"
hooks = [
    f"{rec['allows'] + rec['consent_required']:,} U.S. school districts still have a written rule that lets an adult hit a child. I have been emailing all of them.",
    f"5,359 Texas kids were struck as punishment at school last year. {certs_total} districts have now been recognized for putting a ban in writing.",
    f"I asked 1,000 superintendents one question: can I see your corporal punishment policy? {replied_total} have answered so far. Here is what {period} looked like.",
]
hook = random.choice(hooks)
body_li = f"""{hook}

The Safe Schools Project keeps a public record of every district's own written rule on corporal punishment, quoted from its documents, at earthpilot.org/kids. {period.capitalize()}:

• {sent:,} new requests and invitations sent to superintendents
• {replies:,} replies from districts, read and filed by hand and by machine
• {certs:,} Safe School certificates sent to districts and governors ({certs_total:,} so far)
• The record now stands at {rec['bans']:,} districts that prohibit it, {rec['allows'] + rec['consent_required']:,} that still permit it, and {rec['silent']:,} whose documents say nothing

{("Newly recognized " + period + ": " + ", ".join(wins[:5]) + ".") if wins else "The practice is leaving on its own: Texas reports fell 61 percent in six years with no change in the law."}

The ask to every board that still permits it is one sentence, the one 291 Texas boards already adopted: "The Board prohibits the use of corporal punishment in the District."

If you sit on a school board, or know someone who does, the film and the two-page brief are at earthpilot.org/kids/board/.

#SafeSchools #SchoolBoards #Texas #Education #CorporalPunishment"""
body_fb = f"""{hook}

{period.capitalize()}: {sent:,} requests sent, {replies:,} districts wrote back, {certs:,} Safe School certificates went out ({certs_total:,} total). The public record of every district's own rule is at earthpilot.org/kids.

The whole ask is one sentence: "The Board prohibits the use of corporal punishment in the District." 291 Texas boards already adopted it. If you know a school board member, send them earthpilot.org/kids/board/."""
still = STILLS[(now.timetuple().tm_yday) % len(STILLS)]
path = os.path.join(OUT, f"recap-{now:%Y-%m-%d}{'-weekly' if weekly else ''}.md")
open(path, "w").write(f"# Recap {now:%Y-%m-%d} ({'weekly' if weekly else 'daily'})\n\nImage: {still}\n\n## LinkedIn\n\n{body_li}\n\n## Facebook\n\n{body_fb}\n")
print(path); print(body_li)
if "--no-text" not in sys.argv:
    try:
        dec = json.load(open(os.path.join(ROOT, "data/outreach/decisions.json")))
        tok = next((l.split("=", 1)[1].strip().strip('"') for l in open(os.path.expanduser("~/.escp-deploy.env")) if l.startswith("OPS_TOKEN=")), "") if os.path.exists(os.path.expanduser("~/.escp-deploy.env")) else ""
        link = "earthpilot.org/kids/ops/decisions.html" + (f"#k={tok}" if tok else "")
        cut = (now - datetime.timedelta(hours=24)).isoformat(); done = collections.Counter()
        lp = os.path.join(ROOT, "data/outreach/decisions-log.jsonl")
        for l in (open(lp) if os.path.exists(lp) else []):
            try:
                j = json.loads(l)
                if j.get("t", "") >= cut: done[j.get("by")] += 1
            except Exception: pass
        dline = (f"{dec['count']} decisions waiting: " + "; ".join(dec["lines"][:8]) + f". Tap to approve, hold or redraft: {link} (anything with a clock goes ahead by itself after {dec.get('auto_hours', 24)}h). "
                 + f"Since yesterday: {done['anthony']} you approved, {done['auto']} went ahead on the clock.\n\n")
    except Exception: dline = ""
    msg = dline + f"[{health}] Safe Schools recap draft ({'weekly' if weekly else 'daily'}) is ready. LinkedIn version:\n\n{body_li}\n\nReply 'post' and Claude will put it on LinkedIn and Facebook, or paste it yourself. File: {path}"
    cfg = {}
    for l in open(os.path.expanduser("~/.escp-outreach.env")) if os.path.exists(os.path.expanduser("~/.escp-outreach.env")) else []:
        if "=" in l: k, v = l.strip().split("=", 1); cfg[k] = v.strip().strip('"')
    to = cfg.get("SMS_RECIPIENT") or "+12345162545"
    script = f'tell application "Messages"\nset svc to 1st account whose service type = iMessage\nset b to participant "{to}" of svc\nsend {json.dumps(msg)} to b\nsend POSIX file {json.dumps(still)} to b\nend tell'
    subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    print("texted", to)
