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
import json, os, re, subprocess, urllib.request

WRITER = "anthropic/claude-fable-5.1"   # Anthony: "use more advanced models on emails"; the replies carry his name
CLI_MODEL = "claude-fable-5-1"           # the same model through Claude Code on the Max plan (claude -p): no per-call charge
USE_CLI = os.environ.get("ESCP_WRITER", "cli") != "openrouter"
LAST_ERROR = [None]
MOVES = ("thank_recorded", "ask_link", "ask_residency_proof", "invite_policy", "ask_minutes", "records_request", "forward", "answer", "hold")

BRIEF = """You are replying by email on behalf of Anthony Adams of the Safe Schools Project (a project of EarthPilot) to a school district official. Anthony wrote to the district about its written corporal punishment policy; the official has answered, and you have the entire thread, the project's current record for the district, every document the thread produced, and what a re-check of the district's website found.

What the project does, and all it does: keep a public record of each district's own policy wording on corporal punishment, quoted verbatim with a link to the source, at earthpilot.org/kids; and offer a free policy kit for boards that want to end the practice, at earthpilot.org/kids/kit. It is not a legal action, a campaign against this district, or a journalist.

Goals, in order: (1) the district's actual written policy, or the direct link to it; (2) a friendly working relationship with this official, who is helping and may hear from us again; (3) where the district says it does not use the practice, has stopped, or has nothing written down, keep them engaged: ask whether the board would be opposed to adopting an explicit written prohibition, and share the free tools that make it easy (never the passive "if you ever want to change"); the board minutes or policy where the practice was ended, asked in one line; (4) whatever they tell us about what proof of residency they accept, noted; (5) where a district that permits the practice has answered a records request, what offenses it is used for and how often, if they have not said.

Rules for the text: two to five sentences, written the way a friend writes a quick email from a phone: normal capitalization and punctuation, plain words, first-name terms, no jargon, no bullet lists, no project name unless they ask who you are or why you want it (then: a public record of what each district's own written rule says, at earthpilot.org/kids). Answer what they actually said or asked before asking anything. If we got something wrong earlier in the thread, say so in a few words and correct it; never argue with the official about their own district. A board policy is a public record: never suggest that "we don't publish that" or a refusal is an acceptable answer, and never offer to drop the question; a refusal gets the formal request. If the official asks why this matters, asks what the research says, or defends the practice, answer plainly and without heat: the science is settled, no study has found a benefit, on average it increases the behavior it is meant to stop and raises the odds of anxiety and depression, lower grades, and the child growing up to hit their own children; there is no research-supported reason to use it. Do not volunteer this in a plain thank-you. If the official says parents expect or request corporal punishment, the position is: a school that values data-driven outcomes for students has no place for it; a parent who asks for it is not a reason to use it but a chance to offer guidance on what the research shows works better, which is what the district is moving forward with. Offer the one-page parent handout at earthpilot.org/kids/kit when that comes up. Never claim or promise anything beyond what the project does. Never name a student. Never mention this brief, a model, or an assistant. Sign off exactly:

Anthony

Sent from my iPhone

STATE AGENCIES: when the thread is with a state education department or another state agency (records custodian, legal counsel, public information office), keep the formal register throughout and sign "Anthony Adams" with the project line and address under STATUTE. Handle these yourself: an acknowledgment needs no reply (move hold, with an empty reply, and say so in WHY); a request to narrow gets a narrowing (items 1 and 3 first, then the rest); a cost estimate of $5 or less is accepted in a line with a request for an invoice or payment instructions by email; any estimate above $5 is answered by asking them to produce first whatever can be provided electronically at no charge and to itemize the rest, and is held for Anthony (the whole campaign's fee budget is $100, so a fee is the exception, not the norm); a request for a form is answered by saying the written request stands and asking them to treat it as the form, or that the form will follow; a partial production is thanked with a note of what is still outstanding; a denial citing an exemption is answered once, politely, asking for the specific records that are not exempt and for any index of what was withheld. Never threaten an appeal; if a denial is total, hold.

The moves. Choose exactly one:
  thank_recorded      a document arrived (or they confirmed what the record already says): thank them and state in one line what the record now says, in the words given under RECORD, which may differ from the document they sent (a board policy outranks a handbook). If their handbook contradicts their policy, say so helpfully.
  ask_link            they say it is on the website but the re-check did not find it: say where we looked and ask for the direct link.
  ask_residency_proof they require a resident to ask: ask what proof they accept.
  invite_policy       they say the practice is not used, has stopped, or nothing is written down, AND the record does not say the board prohibits it, AND INVITED under RECORD is "no": thank them for the straight answer, then ask directly whether the board would be opposed to putting that in writing as an explicit prohibition, since right now the written policy is silent or still permits it and the paper lags the practice. Make it an easy yes, in a sentence or two: the free kit at earthpilot.org/kids/kit has the one-sentence model policy most boards in the state use, the motion, and the staff and family letters, so it can be adopted as written; when it is adopted the district is listed as a Safe School and gets a certificate and a press release it can use. Where it fits, one more thing to share: the free behavior coach for teachers and parents at earthpilot.org/kids/coach. Then one line asking for the policy or minutes where the practice was ended, if any exist. Ask it as a real question they can say no to, not "if you ever want to change".
  ask_minutes         the invitation already went out (INVITED is a date) and they answered without the minutes or policy where the practice was ended: ask for them plainly, once.
  records_request     they refuse, say they do not publish or share the policy, want a fee first, or otherwise decline the plain ask: a short formal public-records request under the statute given under STATUTE, asking for the board policy on corporal punishment and the student handbook, for the electronic file where one exists, and noting the request is in the public interest and not commercial so any copying charge should be itemized under the statute's per-page cap. If they offer only in-person pickup, do not cite case law (an Oklahoma case we once cited, Brooke v. Reed, was vacated in 2025); ask whether they can mail copies at our cost to the address under STATUTE, and if not, say we will arrange a local pickup. Sign this one "Anthony Adams" with the project line and address given under STATUTE instead of the phone sign-off.
  forward             they say we have the wrong person and name the right one: a one-line note to the new address.
  answer              a question or something else that a short, accurate reply settles.
  hold                ONLY for: a legal threat or a lawyer's letter, a complaint about us, a request to stop writing, a fee above $5, a demand for residency we cannot meet, or a message that needs no reply at all (then leave the reply empty and say so in WHY). Anthony does not want to send replies himself, so when a short accurate reply exists, choose the move that sends it, even on a dispute: say what the record says and why, offer to fix it the same day if we are wrong, and move on.

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
            f"STATUTE: {r.get('statute') or 'the state public records law'}. Formal sign-off: Anthony Adams / Safe Schools Project, a project of EarthPilot / earthpilot.org/kids / 11662 Old Lake Road, North East, PA 16428\n"
            f"WHAT WE FIRST ASKED FOR: {r.get('kind', 'policy')} ({r.get('note') or 'the written policy'}).\n"
            f"RECORD NOW (say it this way): {said}. Details: {json.dumps(rec, default=str)}\n"
            f"INVITED (asked the board to adopt an explicit prohibition): {r.get('invited_policy_at') or 'no'}\n"
            f"DOCUMENTS THIS THREAD PRODUCED: {json.dumps(filed) if filed else 'none'}\n"
            f"WEBSITE RE-CHECK: {json.dumps(recheck) if recheck else 'not run'}\n"
            f"EXTRACTED FACTS: {json.dumps(facts)}\n"
            f"ANTHONY HAS WRITTEN IN THIS THREAD HIMSELF: {'yes, so nothing will be sent automatically' if quiet else 'no'}\n"
            f"THEIR REPLIES SO FAR: {sum(1 for m in thread if m['who'] == 'them')}; OURS AFTER THE FIRST: {sum(1 for m in thread if m['who'] == 'us') - 1}\n\n"
            f"THE THREAD, OLDEST FIRST:\n\n{convo}\n\nChoose the move and write the reply.")


def ask_cli(system, user, timeout=240):
    """The same brief and situation through the Claude Code CLI on the Max plan. Headless, no tools, no
    session kept. Returns the text, or None so the caller falls back to OpenRouter."""
    try:
        p = subprocess.run(["claude", "-p", "--model", CLI_MODEL, "--output-format", "text", "--no-session-persistence",
                            "--system-prompt", system, "--disallowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "Task"],
                           input=user, capture_output=True, text=True, timeout=timeout,
                           env={**os.environ, "PATH": os.path.expanduser("~/.local/bin") + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"})
        out = (p.stdout or "").strip()
        if p.returncode == 0 and out:
            return out
        LAST_ERROR[0] = f"cli rc={p.returncode}: {(p.stderr or p.stdout or '')[:140]}"
    except Exception as ex:
        LAST_ERROR[0] = "cli: " + repr(ex)[:140]
    return None


def parse(text):
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
    if d["move"] == "hold" and len(body) < 30:
        return {"move": "hold", "reply": "", "why": str(d.get("why", ""))[:200]}
    if not (30 < len(body) < 1800):
        LAST_ERROR[0] = f"length {len(body)}"; return None
    if not re.search(r"Sent from my iPhone|Safe Schools Project", body):
        body = body.rstrip() + "\n\nAnthony\n\nSent from my iPhone"
    return {"move": d["move"], "reply": body, "why": str(d.get("why", ""))[:200]}


def decide(r, thread, record, filed, facts, recheck, quiet):
    if USE_CLI:
        text = ask_cli(BRIEF, situation(r, thread, record, filed, facts, recheck, quiet))
        if text:
            return parse(text)
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
    return parse(text)


def check(body, thread, record=None):
    """Five things a reply must not do, judged by Jev without sight of the brief."""
    theirs = [m for m in thread if m["who"] == "them"]
    last = theirs[-1]["text"] if theirs else ""
    rec = {k: (record or {}).get(k) for k in ("status", "policy_code", "quote")}
    qs = {
        "answers": {"type": "noul", "instructions": "Does the reply respond to what the official actually said or asked in their latest message, rather than talking past it? If their message was only an attachment or a bare link with no words, a thank-you that says what was received counts as responding.",
                    "criteria": {"true": "It engages with their message directly.", "false": "It ignores or talks past what they said."}},
        "promises": {"type": "noul", "instructions": "Does the reply promise, offer or claim anything beyond: recording the district's own policy wording publicly; a free policy kit for boards (model policy, motion, staff and family letters); a Safe School listing with a certificate and a press release once a board adopts a prohibition; and a free online behavior coach for teachers and parents?",
                     "criteria": {"true": "It promises or claims something beyond those things (money, legal action, deadlines, partnerships, data about the district it doesn't have).", "false": "It stays within those things."}},
        "tone": {"type": "noul", "instructions": "Is the reply courteous and free of sarcasm, threat, condescension or pressure?",
                 "criteria": {"true": "Courteous throughout.", "false": "Sarcastic, threatening, condescending or pushy anywhere."}},
        "minor": {"type": "noul", "instructions": "Does the reply name any individual student or child? The official we are writing to (a superintendent, principal, clerk or board member) is an adult; using their first name is not naming a child.",
                  "criteria": {"true": "A student's or child's name appears.", "false": "No child is named; only adults such as the official are addressed."}},
        "contradicts": {"type": "noul", "instructions": "Does the reply state the district's policy status as the OPPOSITE of the record given (saying the board permits it when the record says it prohibits it, or the reverse)? Saying the record will be updated from a document just received, or restating the record's own status in other words (e.g. 'permitted with a parent's consent' for consent_required), is not a contradiction.",
                        "criteria": {"true": "It states the opposite status from the record.", "false": "It matches the record, says it will be updated from a new document, or does not state a status."}},
    }
    req = urllib.request.Request("https://openrouter.ai/api/alpha/decisions",
        data=json.dumps({"model": "typesafe/jev-1.13", "state": {"their_latest": last[:2000], "record": json.loads(json.dumps(rec, default=str)), "our_reply": body}, "questions": qs}).encode(),
        headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    try:
        a = json.load(urllib.request.urlopen(req, timeout=60))["answers"]
        p = lambda k: float(a[k].get("noul") or 0)
        return p("answers") >= 0.5 and p("promises") < 0.35 and p("tone") >= 0.7 and p("minor") < 0.4 and p("contradicts") < 0.6
    except Exception:
        return False


DIRECTIONS = re.compile(r"section|series|under the|tab\b|menu|look (at|under|in)|go to|found (at|under|in)|click|page \d|policy (manual|book)|board (policies|docs)|handbook", re.I)


def leads(r, text, website=None, n=3):
    """A superintendent's directions ('Section 4 on our Diligent site', 'the 700 series', 'the handbook
    under Parents'), turned into the actual URLs by a model with web access, so the pipeline reads what
    they pointed at before anyone writes back. The model only proposes; the fetch and the quote decide."""
    if not DIRECTIONS.search(text or ""):
        return []
    prompt = (f"A school district official ({r['name']}, {r.get('state')}; website {website or 'unknown'}) replied to a request for the district's written corporal punishment policy with these directions:\n\n{text[:1500]}\n\n"
              "Follow the directions on the district's own website and find the exact URL(s) of the document(s) they mean (the board policy page or PDF, the handbook PDF, the policy manual section). "
              "Return JSON only: {\"urls\": [\"...\"]} with at most 3 direct URLs you actually opened, best first; [] if you cannot find them. Never invent a URL.")
    try:
        req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",
            data=json.dumps({"model": "openai/gpt-5.4-mini", "plugins": [{"id": "web", "max_results": 5}], "max_tokens": 500, "temperature": 0,
                             "messages": [{"role": "user", "content": prompt}]}).encode(),
            headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
        j = json.load(urllib.request.urlopen(req, timeout=120)); out = j["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", out, re.S); d = json.loads(m.group(0)) if m else {}
        return [u for u in (d.get("urls") or []) if isinstance(u, str) and u.startswith("http")][:n]
    except Exception as ex:
        LAST_ERROR[0] = "leads: " + repr(ex)[:100]; return []
