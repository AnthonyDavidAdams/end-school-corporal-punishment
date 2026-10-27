"""The scoreboard. The objective of the game is a written ban covering every child; the score is how many children
one covers today, weighted by enrollment, by state and nationally.

  python3 tools/game/score.py            # write data/game/score.json, append a line to data/game/score-history.jsonl
  python3 tools/game/score.py --print    # the same, and print the national line and the top states

How a child is counted:
  covered_by_state_law      enrolled in a state whose law bans the practice, whatever the district says
  covered_by_district_ban   enrolled in a district whose own policy bans it, in a state whose law permits it
  covered                   the sum of those two; the score
  exposed                   enrolled under a district policy that allows it or allows it with parental consent, in a permitting state
  unmapped                  enrolled in a permitting state where the district's documents say nothing (silent) or no one has looked (unknown)
  unrecorded                enrolled in a permitting state in a district the record does not hold yet (the federal count minus the record)
  policy_lag                enrolled in a district that permits on paper and reported zero use in the last federal count: the nearest wins
A district with no enrollment on file is counted in the district tallies and in `enrollment_unknown_districts`,
never guessed. Enrollment is CRDC 2023-24 (see tools/game/common.py)."""
import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import GAME, load_districts, load_states, load_policy_lag, enrollment_map, write_json, append_jsonl, now_iso, today, PERMITTING

SCORE = os.path.join(GAME, "score.json"); HISTORY = os.path.join(GAME, "score-history.jsonl")
STATUSES = ("bans", "allows", "consent_required", "silent", "unknown")

def compute():
    ds, laws, enr = load_districts(), load_states(), enrollment_map()
    lag = load_policy_lag(); lag_ids = {str(d.get("nces_id")) for d in lag}
    universe = collections.Counter()   # every public LEA in the federal count, by state: the denominator
    import csv
    from common import ENROLLMENT_CSV
    if os.path.exists(ENROLLMENT_CSV):
        for r in csv.DictReader(open(ENROLLMENT_CSV)):
            if r.get("state"): universe[r["state"]] += int(r["enrollment"] or 0)
    states = {}
    for code, law in laws.items():   # a banned state with no district records still scores: its law covers every child
        states[code] = {"law": law.get("status", "unknown"), "districts": collections.Counter(), "students": collections.Counter(), "enrollment_unknown_districts": 0,
                        "covered": 0, "covered_by_state_law": 0, "covered_by_district_ban": 0, "exposed": 0, "unmapped": 0, "unrecorded": 0,
                        "policy_lag_districts": 0, "policy_lag_students": 0, "conflict_districts": 0, "total_students": 0, "universe_students": universe.get(code, 0)}
    for d in ds:
        st = states.setdefault(d["state"], {"law": "unknown", "districts": collections.Counter(), "students": collections.Counter(), "enrollment_unknown_districts": 0,
                                            "covered": 0, "covered_by_state_law": 0, "covered_by_district_ban": 0, "exposed": 0, "unmapped": 0, "unrecorded": 0,
                                            "policy_lag_districts": 0, "policy_lag_students": 0, "conflict_districts": 0, "total_students": 0, "universe_students": universe.get(d["state"], 0)})
        s = d["status"] if d["status"] in STATUSES else "unknown"
        e = d["enrollment"]
        st["districts"][s] += 1
        if e is None: st["enrollment_unknown_districts"] += 1; e = 0
        st["students"][s] += e; st["total_students"] += e
        banned_state = st["law"] == "banned"
        if banned_state:
            if s in PERMITTING: st["conflict_districts"] += 1      # a district rule out of step with its own state's law
        elif s == "bans": st["covered_by_district_ban"] += e
        elif s in PERMITTING: st["exposed"] += e
        else: st["unmapped"] += e
        if d["nces_id"] in lag_ids and s in PERMITTING:
            st["policy_lag_districts"] += 1; st["policy_lag_students"] += e
    for st in states.values():
        # In a banned state the law is the written ban: every enrolled child in the federal count is covered. In a
        # permitting state, children in districts the record has not reached yet are "unrecorded", neither side.
        if st["law"] == "banned": st["covered_by_state_law"] = max(st["universe_students"], st["total_students"])
        else: st["unrecorded"] = max(0, st["universe_students"] - st["total_students"])
        st["covered"] = st["covered_by_state_law"] + st["covered_by_district_ban"]
    nat = {"law": None, "districts": collections.Counter(), "students": collections.Counter()}
    for k in ("enrollment_unknown_districts", "covered", "covered_by_state_law", "covered_by_district_ban", "exposed", "unmapped", "unrecorded", "policy_lag_districts", "policy_lag_students", "conflict_districts", "total_students", "universe_students"): nat[k] = 0
    for st in states.values():
        nat["districts"].update(st["districts"]); nat["students"].update(st["students"])
        for k in nat:
            if k not in ("law", "districts", "students"): nat[k] += st[k]
    nat["states_banned"] = sum(1 for v in laws.values() if v.get("status") == "banned")
    nat["states_permitting"] = sum(1 for v in laws.values() if v.get("status") in ("legal", "partial"))
    for st in list(states.values()) + [nat]:
        st["districts"] = dict(st["districts"]); st["students"] = dict(st["students"])
        denom = max(st["universe_students"], st["total_students"])
        st["covered_share"] = round(st["covered"] / denom, 4) if denom else None
    # the permitting states, worst exposure first: where the next points are
    order = sorted((k for k, v in states.items() if v["law"] != "banned"), key=lambda k: -states[k]["exposed"])
    return {"as_of": now_iso(), "how": "students covered by a written ban (state law, or the district's own policy where the law permits it), over every public school student in the CRDC 2023-24 count",
            "national": nat, "states": dict(sorted(states.items())), "permitting_states_by_exposure": order}

def history_line(score):
    n = score["national"]
    return {"date": today(), "at": score["as_of"], "covered": n["covered"], "covered_by_state_law": n["covered_by_state_law"], "covered_by_district_ban": n["covered_by_district_ban"],
            "exposed": n["exposed"], "unmapped": n["unmapped"], "policy_lag_students": n["policy_lag_students"], "policy_lag_districts": n["policy_lag_districts"],
            "unrecorded": n["unrecorded"], "universe_students": n["universe_students"], "covered_share": n["covered_share"], "states_banned": n["states_banned"], **{f"districts_{k}": n["districts"].get(k, 0) for k in STATUSES}}

def main():
    score = compute(); write_json(SCORE, score); append_jsonl(HISTORY, [history_line(score)])
    n = score["national"]
    if "--print" in sys.argv or "-q" not in sys.argv:
        print(f"score {today()}: {n['covered']:,} of {n['universe_students']:,} students covered ({n['covered_share']:.1%}); {n['exposed']:,} exposed; {n['unmapped']:,} unmapped; {n['unrecorded']:,} unrecorded; "
              f"{n['policy_lag_students']:,} in {n['policy_lag_districts']} policy-lag districts. Districts: " + ", ".join(f"{k} {n['districts'].get(k, 0)}" for k in STATUSES)
              + f"; {n['enrollment_unknown_districts']} without enrollment")
        if "--print" in sys.argv:
            print(f"{'state':5} {'law':8} {'covered':>10} {'exposed':>10} {'unmapped':>10} {'lag':>9}  bans/allows/consent/silent/unknown")
            for k in score["permitting_states_by_exposure"][:20]:
                s = score["states"][k]; d = s["districts"]
                print(f"{k:5} {s['law']:8} {s['covered']:>10,} {s['exposed']:>10,} {s['unmapped']:>10,} {s['policy_lag_students']:>9,}  {d.get('bans',0)}/{d.get('allows',0)}/{d.get('consent_required',0)}/{d.get('silent',0)}/{d.get('unknown',0)}")
    return score

if __name__ == "__main__":
    main()
