#!/usr/bin/env tools/.venv/bin/python
"""A clean copy of a Safe School certificate that printed a true ban badly.

The record is right and the district earned the certificate; what went out was wrong on the page: the board's
sentence garbled by a scan's text layer, an unrelated sentence ahead of it, a handbook line where the board
policy belonged, or a sentence so long the signature fell off the frame (six of these were found on
2026-11-11). This renders the certificate again from the record as it stands, through the same evidence gate
and second reading a first certificate passes, sets the copy that went out aside under
out/certificates/withdrawn/, and queues one HELD note of kind "certificate_reissue" on the certificate's own
thread with the clean PDF and a matching press release attached. Nothing is sent here; the engine sends a
row only after it is released from the desk.

    tools/.venv/bin/python tools/certificates/reissue.py dddc5ae250:garbled 5008db469f:layout
    tools/.venv/bin/python tools/certificates/reissue.py --dry 94384f4a09:extra

Reasons: garbled, extra, wrong_document, layout. A certificate that rested on a WRONG record is not this
tool's business: that one is withdrawn with a "retraction", never reissued over the same record.
"""
import datetime, fcntl, glob, hashlib, os, shutil, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools/certificates")); sys.path.insert(0, os.path.join(ROOT, "tools/outreach"))
import send, run, evidence  # noqa: E402

REASONS = ("garbled", "extra", "wrong_document", "layout")
ASIDE = os.path.join(ROOT, "out/certificates/withdrawn")


def record(state, nces_id):
    for x in yaml.safe_load(open(os.path.join(ROOT, "data/districts", f"{state}.yaml")))["districts"]:
        if str(x.get("nces_id")) == str(nces_id): return x


def main():
    dry = "--dry" in sys.argv; asks = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not asks: print(__doc__); return
    lock = open(run.REQ + ".lock", "w"); fcntl.flock(lock, fcntl.LOCK_EX)   # the engine holds this for a whole cycle; wait for it
    reqs = run.load(); by_id = {r["id"]: r for r in reqs}; stop_ids, stop_addrs = run.stop_sets(reqs); yr = send.YEAR.replace("–", "-"); n = 0
    for ask in asks:
        cid, _, reason = ask.partition(":"); c = by_id.get(cid)
        def skip(why): print(f"skipped  {cid}  {(c or {}).get('name', '')}: {why}")
        if not c or c.get("kind") != "certificate" or c.get("status") != "sent": skip("not a sent certificate"); continue
        if reason not in REASONS: skip(f"reason must be one of {', '.join(REASONS)}"); continue
        if c.get("retracted_at"): skip("that certificate was withdrawn; a withdrawn certificate is not reissued"); continue
        if any(r.get("kind") == "certificate_reissue" and r.get("parent_request") == cid and r.get("status") != "dropped" for r in reqs): skip("a clean copy is already queued or sent"); continue
        if str(c.get("nces_id")) in stop_ids or (c.get("to") or "").lower() in stop_addrs: skip("the district asked not to be written to, or the thread is in Anthony's hands"); continue
        x = record(c["state"], c["nces_id"])
        if not x or x.get("status") != "bans": skip("the record no longer says the board prohibits it"); continue
        if not (x.get("policy_code") or x.get("method") == "records_request"): skip("no board policy on file: the same rule a first certificate has to meet"); continue
        why = evidence.certificate_problem(x, c["state"], read_text=run.doc_text, jev=False)
        if why: skip(why); continue
        quote = evidence.print_sentence(x["quote"]); score = evidence.second_reading(quote, x["name"], c["state"])
        if score is None or score < 0.5: skip(f"the second reading does not take the sentence as a board's prohibition ({score})"); continue
        d = {"state": c["state"], "name": x["name"], "quote": quote, "code": str(x.get("policy_code") or "as sent by the district"), "superintendent": c.get("superintendent")}
        slug = os.path.basename(c.get("certificate_pdf") or "")[:-4]
        if dry: print(f"would reissue  {c['state']}  {send.clean_name(x['name'])}  [{reason}]  second reading {score:.2f}\n    “{quote}”  ({d['code']})"); continue
        # the copy that went out is kept, once, exactly as it was sent
        os.makedirs(ASIDE, exist_ok=True); kept = []
        for f in glob.glob(os.path.join(send.OUT, slug + ".*")) + glob.glob(os.path.join(send.OUT, slug + "-press-release.docx")):
            to = os.path.join(ASIDE, os.path.basename(f))
            if not os.path.exists(to): shutil.copy2(f, to)
            kept.append((to, f))
        try:
            pdf = send.render(d); docx = send.press_release_docx(d, pdf[:-4] + "-press-release.docx")
        except Exception as e:
            for to, f in kept: shutil.copy2(to, f)   # a failed render leaves the folder as it was
            skip(f"render failed: {str(e).strip()[-160:]}"); continue
        name = send.clean_name(x["name"])
        row = {"id": hashlib.sha1(f"certificate_reissue|{c['state']}|{c['nces_id']}|{cid}".encode()).hexdigest()[:10], "state": c["state"], "name": c["name"], "nces_id": c["nces_id"], "kids": c.get("kids"),
               "kind": "certificate_reissue", "reason": reason, "to": c["to"], "superintendent": c.get("superintendent"), "parent_request": cid, "sent_on": c["sent_at"],
               "policy_code": x.get("policy_code"), "quote": quote,
               "attachments": [{"path": os.path.relpath(pdf, ROOT), "name": f"Safe School {yr} - {name}.pdf"}, {"path": os.path.relpath(docx, ROOT), "name": f"Press release - {name} Safe School {yr}.docx"}],
               "status": "held", "replies": [], "followup_sent_at": "n/a", "queued_at": datetime.datetime.now().isoformat(timespec="seconds"),
               "notes": f"Clean copy of the certificate of {c['sent_at'][:10]} ({reason}); the copy that went out is kept under out/certificates/withdrawn/. Second reading {score:.2f}. Held for Anthony."}
        reqs.append(row); c["certificate_pdf"] = os.path.relpath(pdf, ROOT); run.save(reqs); n += 1
        print(f"queued, held  {c['state']}  {name}  [{reason}]  -> {c['to']}  ({row['id']})")
    print(f"{n} clean {'copy' if n == 1 else 'copies'} queued and held" if not dry else "dry run: nothing rendered, nothing queued")


if __name__ == "__main__":
    main()
