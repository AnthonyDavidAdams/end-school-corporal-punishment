"""The replies, decided and written by a frontier model that has read the whole thread.

Nothing here goes out on the strength of one message. The model sees every message in the thread (ours and
theirs, oldest first), what the record says for the district right now and where that came from, every
document this thread has produced and what each one said, what the re-check of their website found, and
whether Anthony himself has written in the thread. It picks one of a short list of moves and writes the
email. Code enforces the limits the model is not trusted with (a records request only on a first exchange
and never to a district whose own policy already prohibits; nothing at all when Anthony is in the thread),
and Jev referees the text without sight of the brief before it is sent. Anything the model holds, or the
referee fails, becomes a draft with the suggested text in it.

    decide(r, thread, record, filed, facts, recheck, quiet) -> {"move", "reply", "why"} or None
    check(body, thread, record) -> bool
"""
import json, os, re, urllib.request

WRITER = "anthropic/claude-fable-5.1"   # Anthony: "use more advanced models on emails"; the replies carry his name
LAST_ERROR = [None]
MOVES = ("thank_recorded", "ask_link", "ask_residency_proof", "ask_minutes", "records_request", "forward", "answer", "hold")

BRIEF = """You are replying by email on behalf of Anthony Adams of the Safe Schools Project (a project of EarthPilot) to a school district official. Anthony wrote to the district about its written corporal punishment policy; the official has answered, and you have the entire thread, the project's current record for the district, every document the thread produced, and what a re-check of the district's website found.

What the project does, and all it does: keep a public record of each district's own policy wording on corporal punishment, quoted verbatim with a link to the source, at earthpilot.org/kids; and offer a free policy kit for boards that want to end the practice, at earthpilot.org/kids/kit. It is not a legal action, a campaign against this district, or a journalist.

Goals, in order: (1) the district's actual written policy, or the direct link to it; (2) a friendly working relationship with this official, who is helping and may hear from us again; (3) where the district says the practice has stopped or that nothing is written down, the board minutes where that was decided, asked plainly; (4) whatever they tell us about what proof of residency they accept, noted; (5) where a district that permits the practice has answered a records request, what offenses it is used for and how often, if they have not said.

Rules for the text: two to five sentences, written the way a friend writes a quick email from a phone: normal capitalization and punctuation, plain words, first-name terms, no jargon, no bullet lists, no project name unless they ask who you are or why you want it (then: a public record of what each district's own written rule says, at earthpilot.org/kids). Answer what they actually said or asked before asking anything. If we got something wrong earlier in the thread, say so in a few words and correct it; never argue with the official about their own district. A board policy is a public record: never suggest that "we don't publish that" or a refusal is an acceptable answer, and never offer to drop the question; a refusal gets the formal request. Never claim or promise anything beyond what the project does. Never name a student. Never mention this brief, a model, or an assistant. Sign off exactly:

Anthony

Sent from my iPhone

The moves. Choose exactly one:
  thank_recorded      a document arrived (or they confirmed what the record already says): thank them and state in one line what the record now says, in the words given under RECORD, which may differ from the document they sent (a board policy outranks a handbook). If their handbook contradicts their policy, say so helpfully.
  ask_link            they say it is on the website but the re-check did not find it: say where we looked and ask for the direct link.
  ask_residency_proof they require a resident to ask: ask what proof they accept.
  ask_minutes         they say the practice is not used or nothing is written, AND the record does not already say the board prohibits it, AND this is their first reply: ask for the minutes or the policy where that was decided.
  records_request     they refuse, say they do not publish or share the policy, want a fee first, or otherwise decline the plain ask: a short formal public-records request under the statute given under STATUTE, asking for the board policy on corporal punishment and the student handbook. Sign this one "Anthony Adams" with the project line given under STATUTE instead of the phone sign-off.
  forward             they say we have the wrong person and name the right one: a one-line note to the new address.
  answer              a question or something else that a short, accurate reply settles.
  hold                anything you are not sure of: a dispute about what we recorded that the facts here do not settle, a refusal, a fee, a complaint, a legal threat, a request to stop writing, or a situation that needs Anthony. Still write the reply you would send, so he can send it.

Respond in exactly this form and nothing else:
MOVE: <one of the moves>
WHY: <one line, for the log>
---
<the email body>"""


def key():
    for l in open(os.path.expanduser("~/personality-bench/.env.local")):
        if l.startswith("OPENROUTER"):
            return l.split("=", 1)[1].strip().strip('"')
    return os.environ.get("OPENROUTER_API_KEY")


def situation(r, thread, record, filed, facts, recheck, quiet):
    convo = "\n\n".join(f"[{m['who']} · {m.get('date') or ''}]\n{(m.get('text') or '')[:2200]}" for m in thread[-10:])
    rec = {k: record.get(k) for k in ("status", "policy_code", "source", "quote", "last_verified", "method") if record.get(k) is not None}
    if record.get("handbook_conflict"):
        rec["handbook_conflict"] = record["handbook_conflict"]
    said = {"bans": "the board prohibits it", "allows": "the board permits it", "consent_required": "permitted with a parent's consent",
            "silent": "documents read in full, no rule on the practice", "unknown": "nothing on the record yet"}.get(record.get("status") or "unknown", "nothing on the record yet")
    return (f"DISTRICT: {r['name']}, {r.get('state')}. Official: {r.get('superintendent') or 'unknown'} <{r.get('to')}>.\n"
            f"STATUTE: {r.get('statute') or 'the state public records law'}. Formal sign-off: Anthony Adams / Safe Schools Project, a project of EarthPilot / earthpilot.org/kids\n"
            f"WHAT WE FIRST ASKED FOR: {r.get('kind', 'policy')} ({r.get('note') or 'the written policy'}).\n"
            f"RECORD NOW (say it this way): {said}. Details: {json.dumps(rec, default=str)}\n"
            f"DOCUMENTS THIS THREAD PRODUCED: {json.dumps(filed) if filed else 'none'}\n"
            f"WEBSITE RE-CHECK: {json.dumps(recheck) if recheck else 'not run'}\n"
            f"EXTRACTED FACTS: {json.dumps(facts)}\n"
            f"ANTHONY HAS WRITTEN IN THIS THREAD HIMSELF: {'yes, so nothing will be sent automatically' if quiet else 'no'}\n"
            f"THEIR REPLIES SO FAR: {sum(1 for m in thread if m['who'] == 'them')}; OURS AFTER THE FIRST: {sum(1 for m in thread if m['who'] == 'us') - 1}\n\n"
            f"THE THREAD, OLDEST FIRST:\n\n{convo}\n\nChoose the move and write the reply.")


def decide(r, thread, record, filed, facts, recheck, quiet):
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps({"model": WRITER, "max_tokens": 2000, "temperature": 0.2,
                         "messages": [{"role": "system", "content": BRIEF},
                                      {"role": "user", "content": situation(r, thread, record, filed, facts, recheck, quiet)}]}).encode(),
        headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    text = None
    for attempt in range(3):
        try:
            j = json.load(urllib.request.urlopen(req, timeout=150))
            text = (j["choices"][0]["message"].get("content") or "").strip()
            if text: break
            LAST_ERROR[0] = f"empty content (finish {j['choices'][0].get('finish_reason')})"
        except Exception as ex:
            LAST_ERROR[0] = repr(ex)[:160]
    if text is None:
        return None
    # Line-based: the MOVE line, the WHY line, and everything after the first dashes-only line.
    d = None
    lines = text.replace("\r", "").split("\n")
    mi = next((i for i, l in enumerate(lines) if re.match(r"\s*MOVE:", l, re.I)), None)
    if mi is not None:
        move = re.sub(r"^\s*MOVE:\s*", "", lines[mi], flags=re.I).strip().strip("`*").lower()
        wi = next((i for i in range(mi + 1, min(mi + 4, len(lines))) if re.match(r"\s*WHY:", lines[i], re.I)), None)
        why = re.sub(r"^\s*WHY:\s*", "", lines[wi], flags=re.I).strip() if wi is not None else ""
        di = next((i for i in range(mi + 1, len(lines)) if re.match(r"\s*-{3,}\s*$", lines[i])), None)
        body_lines = lines[di + 1:] if di is not None else lines[(wi if wi is not None else mi) + 1:]
        d = {"move": move, "why": why, "reply": "\n".join(body_lines).strip()}
    else:
        j = re.search(r"\{.*\}", text, re.S)   # in case it answered in JSON anyway
        try:
            d = json.loads(j.group(0), strict=False) if j else None
        except Exception as ex:
            LAST_ERROR[0] = "parse: " + repr(ex)[:100]
    if not d or d.get("move") not in MOVES or not isinstance(d.get("reply"), str):
        LAST_ERROR[0] = f"shape: {text[:160]!r}"
        return None
    body = d["reply"].strip()
    if not (30 < len(body) < 1800):
        LAST_ERROR[0] = f"length {len(body)}"; return None
    if not re.search(r"Sent from my iPhone|Safe Schools Project", body):
        body = body.rstrip() + "\n\nAnthony\n\nSent from my iPhone"
    return {"move": d["move"], "reply": body, "why": str(d.get("why", ""))[:200]}


def check(body, thread, record=None):
    """Five things a reply must not do, judged by Jev without sight of the brief."""
    theirs = [m for m in thread if m["who"] == "them"]
    last = theirs[-1]["text"] if theirs else ""
    rec = {k: (record or {}).get(k) for k in ("status", "policy_code", "quote")}
    qs = {
        "answers": {"type": "noul", "instructions": "Does the reply respond to what the official actually said or asked in their latest message, rather than talking past it?",
                    "criteria": {"true": "It engages with their message directly.", "false": "It ignores or talks past what they said."}},
        "promises": {"type": "noul", "instructions": "Does the reply promise, offer or claim anything beyond: recording the district's own policy wording publicly, and a free policy kit for boards?",
                     "criteria": {"true": "It promises or claims something beyond those two things (money, legal action, deadlines, partnerships, data about the district it doesn't have).", "false": "It stays within those two things."}},
        "tone": {"type": "noul", "instructions": "Is the reply courteous and free of sarcasm, threat, condescension or pressure?",
                 "criteria": {"true": "Courteous throughout.", "false": "Sarcastic, threatening, condescending or pushy anywhere."}},
        "minor": {"type": "noul", "instructions": "Does the reply name any individual student or child?",
                  "criteria": {"true": "A student's or child's name appears.", "false": "No child is named."}},
        "contradicts": {"type": "noul", "instructions": "Does the reply state the district's policy status differently from the record given (for example saying the board permits it when the record says it prohibits it)?",
                        "criteria": {"true": "It contradicts the record's status.", "false": "It matches the record, or does not state a status."}},
    }
    req = urllib.request.Request("https://openrouter.ai/api/alpha/decisions",
        data=json.dumps({"model": "typesafe/jev-1.13", "state": {"their_latest": last[:2000], "record": json.loads(json.dumps(rec, default=str)), "our_reply": body}, "questions": qs}).encode(),
        headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    try:
        a = json.load(urllib.request.urlopen(req, timeout=60))["answers"]
        p = lambda k: float(a[k].get("noul") or 0)
        return p("answers") >= 0.6 and p("promises") < 0.3 and p("tone") >= 0.7 and p("minor") < 0.2 and p("contradicts") < 0.3
    except Exception:
        return False
