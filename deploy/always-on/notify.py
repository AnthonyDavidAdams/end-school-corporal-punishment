#!/usr/bin/env python3
"""One way to reach Anthony from any host: iMessage on the laptop, email or a webhook anywhere else.

    ESCP_NOTIFY=imessage   osascript to the Messages app (macOS only). Recipient: SMS_RECIPIENT.
    ESCP_NOTIFY=smtp       an email over Gmail SMTP with the same IMAP_USER / IMAP_PASSWORD the pipeline
                           already uses, to ESCP_NOTIFY_TO (default: IMAP_USER, i.e. a note to self).
    ESCP_NOTIFY=webhook    POST {"text": ...} as JSON to ESCP_NOTIFY_WEBHOOK (Slack-style; a LoopMessage
                           or Phone-agent relay fits here too).

Unset, it picks imessage when osascript exists (the laptop) and smtp otherwise (the host). A mode that cannot
work where it runs (imessage on Linux, smtp with no password) falls through to the next one that can, and as a
last resort prints the text to stdout so nothing is ever silently lost.

    python3 notify.py "text"             send
    python3 notify.py --dry-run "text"   print what would be sent, send nothing
    from notify import send; send(text, subject=None)
"""
import json
import os
import shutil
import smtplib
import subprocess
import sys
import urllib.request
from email.message import EmailMessage


def _envfile(path):
    d = {}
    p = os.path.expanduser(path)
    if os.path.exists(p):
        for l in open(p):
            if "=" in l and not l.lstrip().startswith("#"):
                k, v = l.strip().split("=", 1); d[k] = v.strip().strip('"')
    return d


def settings():
    cfg = {**_envfile("~/inbox-brief/config.env"), **_envfile("~/.escp-outreach.env")}
    get = lambda k, d=None: os.environ.get(k) or cfg.get(k) or d
    return {"user": get("IMAP_USER"), "pw": get("IMAP_PASSWORD"), "sms": get("SMS_RECIPIENT"),
            "to": get("ESCP_NOTIFY_TO") or get("IMAP_USER"), "webhook": get("ESCP_NOTIFY_WEBHOOK"),
            "mode": (os.environ.get("ESCP_NOTIFY") or "").strip().lower()}


def order(s):
    first = s["mode"] or ("imessage" if shutil.which("osascript") and sys.platform == "darwin" else "smtp")
    rest = [m for m in ("smtp", "webhook", "imessage") if m != first]
    return [first] + rest


def via_imessage(text, s):
    if sys.platform != "darwin" or not shutil.which("osascript") or not s["sms"]: return False
    script = f'tell application "Messages" to send {json.dumps(text)} to buddy {json.dumps(s["sms"])} of (service 1 whose service type is iMessage)'
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=30)
    return r.returncode == 0


def via_smtp(text, s, subject=None):
    if not (s["user"] and s["pw"] and s["to"]): return False
    m = EmailMessage(); m["From"] = f"Safe Schools engine <{s['user']}>"; m["To"] = s["to"]
    m["Subject"] = subject or ("[Safe Schools] " + text.strip().splitlines()[0][:80])
    m.set_content(text)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=60) as c:
        c.login(s["user"], s["pw"]); c.send_message(m)
    return True


def via_webhook(text, s, subject=None):
    if not s["webhook"]: return False
    req = urllib.request.Request(s["webhook"], data=json.dumps({"text": text, "subject": subject}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return 200 <= r.status < 300


def send(text, subject=None, dry_run=False):
    """Returns the mode that carried the message, or "stdout"."""
    s = settings()
    if os.environ.get("ESCP_NOTIFY_DRY_RUN") == "1":   # a safety catch for tests: nothing leaves the machine
        dry_run = True
    if dry_run:
        print(f"[dry-run] would notify via {order(s)[0]} (fallbacks {order(s)[1:]}); to={'(sms) ' + str(s['sms']) if order(s)[0] == 'imessage' else s['to'] if order(s)[0] == 'smtp' else s['webhook']}")
        print(text); return "dry-run"
    for mode in order(s):
        try:
            ok = {"imessage": lambda: via_imessage(text, s), "smtp": lambda: via_smtp(text, s, subject), "webhook": lambda: via_webhook(text, s, subject)}[mode]()
            if ok: return mode
        except Exception as ex:
            print(f"notify: {mode} failed: {ex!r}", file=sys.stderr)
    print("notify (no channel worked):", text)
    return "stdout"


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    if not args: print(__doc__); sys.exit(2)
    print(send(" ".join(args), dry_run="--dry-run" in sys.argv))
