"""Everything the Safe Schools Project says, in one place.

The first email is not a records request. It is one person asking another for a link they could not
find, by first name, in four sentences. That is both kinder and more effective: a superintendent who
gets a statute in the first line answers like a lawyer, and in Arkansas answers "are you a resident?"
A superintendent who gets "hey Mike, I can't find your handbook, can you help?" usually just sends it.

The statute exists and gets used, but only after a district has declined a plain ask, and it is named
in the sentence that asks for it rather than in the opening. Escalations (board minutes, the research
a board relied on) are their own messages with their own tone: still plain, still short, but explicit
that they are requests under the state's law.

Nothing here is generated at send time except the district's name, the recipient's first name and the
compliment line, which comes from compliment.py and is checked against its own source before it ships.
"""
import re

STATE_NAMES = {"AL": "Alabama", "AR": "Arkansas", "AZ": "Arizona", "CO": "Colorado", "DE": "Delaware",
               "FL": "Florida", "GA": "Georgia", "ID": "Idaho", "IN": "Indiana", "KS": "Kansas",
               "KY": "Kentucky", "LA": "Louisiana", "MO": "Missouri", "MS": "Mississippi",
               "NC": "North Carolina", "NH": "New Hampshire", "OK": "Oklahoma", "SC": "South Carolina",
               "TN": "Tennessee", "TX": "Texas", "VA": "Virginia", "WY": "Wyoming"}


def state_name(code):
    return STATE_NAMES.get(str(code or "").upper(), str(code or "your state"))


PROJECT = "Safe Schools Project"
PARENT = "EarthPilot"
MAIL = "11662 Old Lake Road, North East, PA 16428"   # the campaign's mailing address (Anthony, 2026-10-09)
PHONE = "(234) 516-2545"                               # the MAJIK line; the phone agent answers as the receptionist
SITE = "earthpilot.org/kids"


def first_name(sup, fallback="there"):
    """'Downs, David' -> 'David'; 'David Downs' -> 'David'; 'Dr. David Downs' -> 'David'."""
    s = re.sub(r"\b(dr|mr|mrs|ms|supt|superintendent|ed\.?s|ed\.?d|ph\.?d)\.?\b", " ", str(sup or ""), flags=re.I)
    s = re.sub(r"[^A-Za-z,'\- ]", " ", s).strip()
    if not s:
        return fallback
    if "," in s:
        part = s.split(",")[1].strip()
    else:
        part = s.split()[0]
    part = part.split()[0] if part.split() else ""
    return part.capitalize() if len(part) > 1 else fallback


def sig(user, formal=False):
    """The signature. The project is named, and so is who actually runs it: no one has to guess."""
    if formal:
        return f"Anthony Adams\n{PROJECT}, a project of {PARENT}\n{SITE} · {user}\n{MAIL} · {PHONE}"
    return "Anthony\n\nSent from my iPhone"


def nice(name):
    return name.title() if name.isupper() else name


# ---------------------------------------------------------------- first contact
def ask_policy(r, user, compliment=None):
    """The first ask, the way a friend would put it (Anthony, 2026-10-09). No project name, no preamble,
    no statute: one question. Who we are comes up if they ask, and the formal request if they refuse."""
    who = first_name(r.get("superintendent"))
    return f"""Hey {who},

I'm having trouble finding the policy on corporal punishment. Can you point me to the link or send it over?

{sig(user)}
"""


def records_request(r, user, statute):
    """A district declined the plain ask, or said it does not publish its policy. A board policy is a
    public record in every state the project writes to, so this is the formal request, kept short."""
    who = first_name(r.get("superintendent"))
    d = nice(r["name"])
    return f"""Hi {who},

Understood. Under {statute}, I'm requesting copies of:

  1. {d}'s current board policy on corporal punishment (and the student discipline policy it sits in), as adopted; and
  2. the current student handbook or code of conduct.

Electronic copies by reply are fine; where a record is kept electronically, please provide that file rather than a printout. This request is in the public interest, not commercial, so I'd ask that any copying charge be itemized under the statute's per-page cap. If any part is withheld, please cite the exemption.

{sig(user, formal=True)}
"""


def ask_link(r, user, checked):
    """They said it is on the website. We looked again and it is not where they think it is."""
    who = first_name(r.get("superintendent"))
    tried = "\n".join(f"  {u}" for u in checked[:4])
    return f"""Thanks {who} — I went back through the site and still can't get to it. Here's where I looked:

{tried}

Either I'm missing a page or the copy online is out of date. Could you send the direct link, or the file itself? Page number is fine if it's inside the handbook.

{sig(user)}
"""


def ask_residency_proof(r, user):
    """They want an Arkansas (or Tennessee, or Alabama) resident. Fine: what exactly would you accept?

    Two things happen here. We learn what that office actually requires, which is worth knowing because
    no two of them have asked for the same thing. And we tell them a resident will be making it, which
    is true, and is the point of the exchange.
    """
    who = first_name(r.get("superintendent"))
    st = state_name(r.get("state"))
    return f"""Thanks {who}, that's fair — I'm not an {st} resident.

Two things. What proof of residency does your office accept? A driver's license, a voter registration, something else? I'll have an {st} resident make the request and I want to send exactly what you need the first time rather than go around twice.

And separately from the statute: the policy and the handbook are things you publish anyway. If you'd rather just send the link, that closes it today and nobody has to file anything.

{sig(user)}
"""


# ---------------------------------------------------------------- after a document
def thanks_recorded(r, what, url=None):
    """Received, read, recorded, and here is what we wrote down. Correcting us is one reply away."""
    who = first_name(r.get("superintendent"))
    line = f"\nIt's on the record here: https://{SITE}/state/{r['state']}/\n" if r.get("state") else ""
    return f"""Got it — thank you {who}. {what}
{line}
If we've read it wrong, reply and I'll fix it the same day. We quote the district's own sentence rather than characterise it, so the entry is only as good as the document.

Anthony
{PROJECT} · {SITE}
"""


# ---------------------------------------------------------------- escalations
def ask_minutes(r, user, statute, claim):
    """A district says the practice has stopped, or that there is nothing in writing.

    Both are worth having on paper. A board that ended it decided that somewhere, and the minute is the
    proof the next district's board will want to see. A board with no written rule is running on custom,
    and the record should say which of those two it is.
    """
    who = first_name(r.get("superintendent"))
    d = nice(r["name"])
    return f"""Hi {who},

Thanks for telling me {claim} — that's the useful answer, and I'd like to be able to show it rather than assert it.

Under {statute}, could I get:

  1. the board minutes, transcript or recording, and agenda packet, from the meeting where corporal punishment was last discussed or voted on, whenever that was;
  2. any internal memo or email among administrators or board members about ending it or about the policy; and
  3. the current discipline policy as adopted, even if it doesn't mention the practice.

If the board never took it up formally, saying so in a line is a complete answer and I'll record it that way.

{sig(user, formal=True)}
"""


def ask_research(r, user, statute):
    """The experiment: what a board actually relied on, and how it knows the practice works.

    Districts that keep the practice generally say it works. This asks, specifically, for the paper
    trail behind that belief: what was discussed, what was cited, what is measured, and how. The answer,
    including "there isn't one", is the finding. Sent to a handful of districts, never in bulk.
    """
    who = first_name(r.get("superintendent"))
    d = nice(r["name"])
    return f"""Hi {who},

{d} is one of the districts that still permits corporal punishment. I'd like to understand the reasoning behind that in the board's own words rather than guess at it, so I'm asking a small number of districts the same questions.

Under {statute}, please provide any of the following that exist, for the last ten years:

  1. Transcripts, recordings, minutes and agenda packets of board meetings where corporal punishment was discussed or voted on.
  2. Records of internal discussion of the policy: administrator or staff meeting notes, memos, and emails among board members, the superintendent's office and principals about the policy or proposals to change it.
  3. The research, studies, guidance or training materials the board or administration cited or relied on in adopting or last reviewing the policy.
  4. The outcomes the district uses to judge whether the practice is working (for example repeat offenses, suspensions, attendance, climate surveys), and the method by which those are measured.
  5. Any data, report or review produced under item 4; and the record of each use of corporal punishment, with the offense it was imposed for — the incident log, and the discipline matrix or code that lists which offenses carry it as a consequence.

Where a part does not exist, saying so is a complete answer to it. I'm not looking for a gotcha: if the board has thought this through, that thinking belongs next to the policy on the public record, and if it hasn't, that is worth knowing too.

If it's useful, the material we'd hand any board that wanted to revisit this is at earthpilot.org/kids/kit: what the research says, who has called for ending it, a model policy, and a transition plan. No obligation attached to the request above.

{sig(user, formal=True)}
"""


def ask_handbook_dated(r, user, year):
    """The handbook we found is old. Ask for the current one rather than record a stale rule."""
    who = first_name(r.get("superintendent"))
    return f"""Hi {who},

The most recent {nice(r['name'])} handbook I can find online is the {year} one. Is there a current version, and is the corporal punishment language in it the same? I'd rather record this year's wording than last year's.

{sig(user)}
"""


def wrong_contact(r, user, to_name):
    """Redirected to somebody else. Start over with them, briefly, and say who sent us."""
    return f"""Hi {first_name(to_name)},

{first_name(r.get('superintendent'), 'The office')}'s office pointed me your way. I'm trying to find {nice(r['name'])}'s current corporal punishment policy and the student handbook link, and I can't get to either from the site. Can you point me to them?

We keep a public, sourced record of what each district's own rule says — {SITE}. Quoting yours correctly is the whole job.

{sig(user)}
"""


def nudge(r, user):
    """One soft follow-up. Never a second."""
    who = first_name(r.get("superintendent"))
    return f"""Hi {who} — just bumping this in case it got buried. Still after {nice(r['name'])}'s corporal punishment policy and the handbook link. A URL is plenty.

If it's easier to say "we don't publish that," that's a fine answer too and I'll note it.

{sig(user)}
"""


def offer(r, user):
    """A district with nothing in writing. The grant, offered plainly, with no obligation."""
    who = first_name(r.get("superintendent"))
    kids = r.get("kids")
    count = f" {kids} students in 2023-24" if kids else " students"
    return f"""Thanks {who} — that's a straight answer and I appreciate it.

It does put the district in an odd spot: the practice is on the federal record for {nice(r['name'])} ({count}), and there's nothing on paper saying who may do it, when, or how a parent declines. That's usually how a district ends up in the news for something a policy would have prevented.

{PARENT} runs a free programme for exactly this — a model board policy written to {state_name(r.get('state'))}'s law in whichever direction the board wants, a short staff curriculum, and help through the first year, at no cost and no obligation. Reply and I'll send the policy and a one-page outline.

{sig(user)}
"""


# ---------------------------------------------------------------- state level
def state_doe(state_name, state_code, statute, user, dept, resident=False):
    """One request to a state education agency instead of hundreds to districts.

    Every state agency already holds the three things that take us the longest to assemble by hand: who
    runs each district and how to reach them, where each district publishes its handbook, and whatever
    the state itself collects about the practice. Asking once is cheaper for them than answering the
    same question from us a hundred and seventy times.
    """
    statute = str(statute).rstrip(".")
    local = (f"I live in {state_name}. " if resident else "")
    return f"""Hello,

I'm writing to request public records from the {dept} under {statute}.

{local}I maintain a free public record of every school district's written policy on corporal punishment, quoted from the district's own documents, at {SITE}. Rather than write to every district in {state_name} individually, I'd like to ask the department once for what it already holds:

  1. A current list of {state_name} school districts with, for each: the district's website, the name and email address of the superintendent, and the name and email address of the records custodian or public information officer.

  2. Any list, index or link collection the department maintains of district student handbooks, codes of conduct, or board policy manuals.

  3. Any data the department collects from districts on the use of corporal punishment: counts, incident reporting, or annual filings, for the most recent three years available.

  4. Any department guidance, model policy, training material or correspondence with districts regarding corporal punishment, restraint, or student discipline policy, for the last five years.

  5. Any record of districts that have notified the department of a change to their corporal punishment policy.

Electronic copies are fine and preferred — a spreadsheet or a link is perfect, and nothing needs to be printed. If any part of this is voluminous, I'd rather start with items 1 and 3 than have the whole request delayed, and I'm happy to narrow anything on a phone call.

If fees apply, please tell me the estimate before incurring them. If any part is withheld, please cite the specific exemption.

Thank you,
{sig(user, formal=True)}
"""
