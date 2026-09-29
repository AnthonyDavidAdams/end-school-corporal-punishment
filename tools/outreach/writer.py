"""The replies that are not forms: written, checked, and sent.

Most replies are one of three forms and those go out as templates. The rest -- a superintendent's
real question, a refusal with a reason, a surprise -- used to become Gmail drafts, and Anthony does
not want drafts: "be smart and reply, you know our goals... err on the side of brevity, assume they have
good intentions." So a frontier model writes the reply from a fixed brief and the whole thread, Jev
checks it against four rules it cannot see the brief for, and it goes. If the check fails, it is drafted
after all, which is the safe failure. A few replies a day on Sonnet 5 is a few cents.

Jev does not write anything here. It never has; it sorts replies, and now it referees them.
"""
import json, os, re, urllib.request

WRITER = "anthropic/claude-sonnet-5"

BRIEF = """You are writing a short email reply on behalf of Anthony Adams of the Safe Schools Project (a project of EarthPilot), to a school district official who answered his request for the district's written corporal punishment policy.

Goals, in order: (1) get the district's actual written policy or the direct link to it; (2) keep a friendly working relationship with this official -- they are helping us, and we may write again; (3) where the district says it has stopped, or has nothing in writing, ask plainly for the board minutes where it was decided; (4) note anything they tell us about what proof of residency they accept; (5) when a district that permits the practice replies to a records request, ask, if they have not said, for what offenses it is used and how often -- the incident log or the discipline matrix that lists which offenses carry it.

Rules: three to five sentences, never more. Plain, warm, first-name terms, no jargon. Assume good intentions. Answer what they actually asked before asking anything. Never cite a statute unless they have refused a plain request. Never promise anything beyond what the project does: a public, sourced record of each district's own wording, and a free policy kit at earthpilot.org/kids/kit for boards that want it. Never name a student. Never mention this brief. Sign off exactly:

Anthony
Safe Schools Project · earthpilot.org/kids

Output only the email body."""


def key():
    for l in open(os.path.expanduser("~/personality-bench/.env.local")):
        if l.startswith("OPENROUTER"):
            return l.split("=", 1)[1].strip().strip('"')


def write(r, thread, kind):
    """thread: list of (who, text) oldest first. Returns the body, or None."""
    convo = "\n\n".join(f"[{who}]\n{txt[:1800]}" for who, txt in thread[-6:])
    user = (f"District: {r['name']}, {r.get('state')}. Official: {r.get('superintendent') or 'unknown'}. "
            f"What we know: {r.get('recorded_status') or 'no policy on the record yet'}. Their latest reply was classified as: {kind}.\n\n"
            f"The thread so far:\n\n{convo}\n\nWrite the reply.")
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps({"model": WRITER, "max_tokens": 400, "temperature": 0.3,
                         "messages": [{"role": "system", "content": BRIEF}, {"role": "user", "content": user}]}).encode(),
        headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    try:
        j = json.load(urllib.request.urlopen(req, timeout=90))
        body = j["choices"][0]["message"]["content"].strip()
    except Exception:
        return None
    return body if 40 < len(body) < 1400 else None


def check(body, thread):
    """Four things a reply must not do, judged by Jev without sight of the brief."""
    last = thread[-1][1] if thread else ""
    qs = {
        "answers": {"type": "noul", "instructions": "Does the reply respond to what the official actually said or asked in their latest message, rather than talking past it?",
                    "criteria": {"true": "It engages with their message directly.", "false": "It ignores or talks past what they said."}},
        "promises": {"type": "noul", "instructions": "Does the reply promise, offer or claim anything beyond: recording the district's own policy wording publicly, and a free policy kit for boards?",
                     "criteria": {"true": "It promises or claims something beyond those two things (money, legal action, deadlines, partnerships, data about the district it doesn't have).", "false": "It stays within those two things."}},
        "tone": {"type": "noul", "instructions": "Is the reply courteous and free of sarcasm, threat, condescension or pressure?",
                 "criteria": {"true": "Courteous throughout.", "false": "Sarcastic, threatening, condescending or pushy anywhere."}},
        "minor": {"type": "noul", "instructions": "Does the reply name any individual student or child?",
                  "criteria": {"true": "A student's or child's name appears.", "false": "No child is named."}},
    }
    req = urllib.request.Request("https://openrouter.ai/api/alpha/decisions",
        data=json.dumps({"model": "typesafe/jev-1.13", "state": {"their_latest": last[:2000], "our_reply": body}, "questions": qs}).encode(),
        headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    try:
        a = json.load(urllib.request.urlopen(req, timeout=60))["answers"]
        p = lambda k: float(a[k].get("noul") or 0)
        return p("answers") >= 0.6 and p("promises") < 0.3 and p("tone") >= 0.7 and p("minor") < 0.2
    except Exception:
        return False


def reply(r, thread, kind):
    body = write(r, thread, kind)
    if body and check(body, thread):
        return body
    return None
