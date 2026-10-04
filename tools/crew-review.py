"""Maintainer review of everything pending on the crew server, by rule, then merge what was approved.

The rules are the ones a careful reviewer applies by hand, written down once:
  district findings    approve when the quote was verified against the source by the server and the
                       status is one of the three real answers; hold when the record already carries a
                       different quoted status (a person looks); reject "looked, found nothing" so the
                       district stays on the worklist instead of entering the record as unknown.
  recovered sources    same rule as a district finding.
  contacts             approve an office contact with a federal id; never a personal mailbox.
  survey / bills       approve when a source is on file.
  share kits, dossiers hold for a person.

    tools/.venv/bin/python tools/crew-review.py            review, merge, publish
    tools/.venv/bin/python tools/crew-review.py --dry      say what would happen
"""
import json, os, sys, time, datetime, subprocess, collections, urllib.request, urllib.error
import yaml  # tools/.venv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://escp-mcp-production.up.railway.app/mcp"
DRY = "--dry" in sys.argv
T = open(os.path.expanduser("~/.escp-maintainer.env")).read().split("ESCP_MAINTAINER_TOKEN=")[1].split()[0].strip('"')


def call(name, args, tries=6):
    for i in range(tries):
        try:
            req = urllib.request.Request(URL, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}).encode(),
                                         headers={"content-type": "application/json", "accept": "application/json, text/event-stream", "authorization": f"Bearer {T}"})
            body = urllib.request.urlopen(req, timeout=90).read().decode()
            for l in body.split("\n"):
                if l.startswith("data: "):
                    return json.loads(l[6:]).get("result", {})
            return json.loads(body).get("result", {})
        except urllib.error.HTTPError as e:
            if e.code in (502, 503, 504): time.sleep(5 * (i + 1)); continue
            raise
        except Exception:
            time.sleep(5 * (i + 1))
    return {"isError": True, "content": [{"text": "gave up"}]}


def pending(task):
    out = []
    while True:
        r = call("list_pending", {"limit": 500, "task": task})
        t = r.get("content", [{}])[0].get("text", "{}")
        d = json.loads(t) if t.startswith("{") else {"findings": []}
        batch = [x for x in d.get("findings", []) if x["id"] not in {y["id"] for y in out}]
        out += batch
        if len(batch) < 500: break
    return out


def review(fid, decision, note):
    if DRY: return True
    r = call("review_finding", {"id": fid, "decision": decision, "reviewer": "a@175g.com", "note": note, "token": T})
    time.sleep(0.12)
    return not r.get("isError")


# the record, for the disagreement check
rec = {}
for f in os.listdir(os.path.join(ROOT, "data/districts")):
    if not f.endswith(".yaml"): continue
    d = yaml.safe_load(open(os.path.join(ROOT, "data/districts", f)))
    for r in (d if isinstance(d, list) else d.get("districts", [])):
        if r.get("nces_id"): rec[str(r["nces_id"])] = r

tally = collections.Counter(); approved, held = [], []
GOOD = ("allows", "bans", "consent_required")

for task in ("district-policy-scan", "recover-blocked-source"):
    for x in pending(task):
        r = x.get("record") or {}; chk = (x.get("source_check") or {}).get("status"); st = r.get("status")
        sourced = bool(r.get("quote") and r.get("source") and chk in ("cached", "matched", "agent_text") and st in GOOD)
        cur = rec.get(str(r.get("nces_id") or ""))
        if not r.get("nces_id"):
            held.append((task, r.get("state"), r.get("name"), "no federal id")); tally[(task, "held")] += 1; continue
        if not sourced:
            ok = review(x["id"], "rejected", "No verified primary source; the district stays on the worklist rather than entering the record as unknown."); tally[(task, "rejected", ok)] += 1; continue
        if cur and cur.get("quote") and cur.get("status") != st:
            held.append((task, r.get("state"), r.get("name"), f"record {cur.get('status')} ({cur.get('method')}) vs filed {st}: {(r.get('quote') or '')[:90]}")); tally[(task, "held")] += 1; continue
        ok = review(x["id"], "approved", f"Quote verified against the {chk} source; status {st}."); tally[(task, "approved", ok)] += 1
        if ok: approved.append(r)

for x in pending("contact-capture"):
    r = x.get("record") or {}; c = r.get("contact") or {}; blob = json.dumps(c).lower()
    good = bool(r.get("nces_id") and (c.get("phone") or c.get("email") or c.get("district_email") or c.get("mailing_address")) and not any(d in blob for d in ("gmail.com", "yahoo.com", "hotmail.com", "aol.com")))
    ok = review(x["id"], "approved" if good else "rejected", "Office contact from a public directory, with id." if good else "Missing id or office contact, or a personal mailbox.")
    tally[("contact", "approved" if good else "rejected", ok)] += 1

for task in ("crdc-refresh", "bill-watch"):
    for x in pending(task):
        r = x.get("record") or {}; good = bool(r.get("source") or r.get("url"))
        ok = review(x["id"], "approved" if good else "rejected", "Sourced document on file." if good else "No source."); tally[(task, "approved" if good else "rejected", ok)] += 1

for task in ("share-kit", "decision-maker-dossier", "verify-claim", "training-review", "date-the-change"):
    n = len(pending(task))
    if n: tally[(task, "held for a person")] += n

print("REVIEW:", dict(tally))
for h in held[:30]: print("HELD", h)
if held: print(f"... {len(held)} held in total")

# merge what was approved
if approved and not DRY:
    out = []
    for r in approved:
        x = {k: r.get(k) for k in ("state", "name", "nces_id", "county", "status", "source", "quote", "quotes", "policy_code", "parent_control", "notes", "documents", "policy_adopted", "policy_revised") if r.get(k) is not None}
        x["method"] = "agent_via_crew"; x["last_verified"] = datetime.date.today().isoformat()
        x["notes"] = (x.get("notes") or "") + f" Submitted through the crew server; quote verified against the source by the server and approved by a maintainer on {x['last_verified']}."
        out.append(x)
    p = os.path.join(ROOT, "out/crew-approved-merge.json"); json.dump(out, open(p, "w"), indent=1)
    print(subprocess.run(["node", "tools/merge-scan.mjs", p], cwd=ROOT, capture_output=True, text=True).stdout.strip().splitlines()[-1])
    subprocess.run(["node", "fill-county.mjs"], cwd=os.path.join(ROOT, "tools"), capture_output=True)
    v = subprocess.run(["node", "validate.mjs"], cwd=os.path.join(ROOT, "tools"), capture_output=True, text=True).stdout.strip().splitlines()[-1]; print(v)
    if "0 failures" in v:
        print(subprocess.run(["bash", "tools/publish.sh", f"Crew review: {len(out)} findings merged"], cwd=ROOT, capture_output=True, text=True).stdout.strip().splitlines()[-1])
    else:
        print("NOT published: validation failed")
print("approved district records:", len(approved))
