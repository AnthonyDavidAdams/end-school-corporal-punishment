"""The weekly review: one page for Anthony with the scoreboard, the experiment table, the next ten targets, and three
proposed new variants written by the model through `claude -p` (the Max plan, never the API). Each proposal is a
proposal: nothing here is queued or sent.

  python3 tools/game/review.py             write out/game/review-<date>.md
  python3 tools/game/review.py --no-llm    the same without the proposals (no model call)
Run on Sundays by tools/social/recap.py (the recap launchd job). Not posted anywhere."""
import os, sys, json, subprocess, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, GAME, today, now, read_jsonl
import score as score_mod, report as report_mod, neighbors as neighbors_mod, assign as assign_mod

OUT = os.path.join(ROOT, "out/game"); os.makedirs(OUT, exist_ok=True)
CLI_MODEL = "claude-fable-5-1"
MOVE_KINDS = "first ask for the policy, records request, follow-up, reply, alignment invitation with the board brief, certificate, board-member note, PTA note, local media pitch, film link, inservice deck, custom video, 1:1 superintendent call"

SYSTEM = """You design message experiments for the Safe Schools Project, a public record of every US school district's own written rule on corporal punishment (earthpilot.org/kids). The objective is a written ban covering every child. Moves are honest, short messages from Anthony Adams to superintendents and boards. Rules: honest persuasion only, nothing invented, no pressure tactics, no em dashes, no exclamation marks, plain words, one ask per message, lowercase-casual tone like a friend's note is fine. Every proposal is for Anthony to approve; nothing you write is sent."""

def proposals(sc, rep, targets, timeout=420):
    n = sc["national"]
    exps = {k: {"question": v.get("question"), "variants": {vid: {kk: vv for kk, vv in s.items() if kk in ("name", "subject", "opener", "ask_size", "attachment", "body", "approved")} for vid, s in (v.get("variants") or {}).items()}} for k, v in assign_mod.experiments().items()}
    user = (f"SCOREBOARD {today()}: {n['covered']:,} of {n['universe_students']:,} students covered ({n['covered_share']:.1%}); {n['exposed']:,} exposed under a permitting district rule; "
            f"{n['unmapped']:,} in silent or unknown districts; {n['policy_lag_students']:,} students in {n['policy_lag_districts']} policy-lag districts (permit on paper, reported zero use).\n\n"
            f"EXPERIMENTS AND THEIR COPY:\n{json.dumps(exps, indent=1)}\n\nRESULTS SO FAR:\n{json.dumps(rep, indent=1)}\n\n"
            f"NEXT TARGETS (permitting districts next to a district that moved):\n{json.dumps([{k: t.get(k) for k in ('state', 'name', 'enrollment', 'status', 'policy_lag', 'anchors')} for t in targets['ranked'][:10]], indent=1)}\n\n"
            f"MOVE KINDS AVAILABLE: {MOVE_KINDS}.\n\n"
            "Propose exactly three new variants or moves worth testing next, each with a hypothesis the ledger can settle. "
            "Use this format for each, nothing else:\n\n"
            "### Proposal N: <experiment or new move kind> / <short variant name>\nHypothesis: <one sentence>\nSubject: <subject line>\nBody:\n<the full message, under 120 words>\nMeasure: <which rate, at how many days, against which variant>\n")
    env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE")}
    env["PATH"] = os.path.expanduser("~/.local/bin") + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    try:
        p = subprocess.run(["claude", "-p", "--model", CLI_MODEL, "--output-format", "text", "--no-session-persistence", "--system-prompt", SYSTEM,
                            "--disallowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "Task"],
                           input=user, capture_output=True, text=True, timeout=timeout, env=env)
        out = (p.stdout or "").strip()
        if p.returncode == 0 and out: return out.replace("—", ",").replace("–", "-")
        return f"(the model call failed: rc={p.returncode} {(p.stderr or '')[:200]})"
    except Exception as ex:
        return f"(the model call failed: {repr(ex)[:200]})"

def scoreboard_md(sc):
    n = sc["national"]; hist = read_jsonl(os.path.join(GAME, "score-history.jsonl"))
    week_ago = (now() - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
    prev = next((h for h in hist if h["date"] <= week_ago), None) if hist else None
    delta = f" ({n['covered'] - prev['covered']:+,} since {prev['date']})" if prev else ""
    lines = [f"**{n['covered']:,} of {n['universe_students']:,} students covered by a written ban ({n['covered_share']:.1%}){delta}.**", "",
             "| | students | districts |", "|---|---:|---:|",
             f"| covered by state law ({n['states_banned']} states) | {n['covered_by_state_law']:,} | |",
             f"| covered by the district's own ban | {n['covered_by_district_ban']:,} | {n['districts'].get('bans', 0):,} |",
             f"| exposed: policy allows or allows with consent | {n['exposed']:,} | {n['districts'].get('allows', 0) + n['districts'].get('consent_required', 0):,} |",
             f"| unmapped: documents silent or not yet read | {n['unmapped']:,} | {n['districts'].get('silent', 0) + n['districts'].get('unknown', 0):,} |",
             f"| unrecorded: in the federal count, not yet in the record | {n['unrecorded']:,} | |",
             f"| nearest wins: permit on paper, reported zero use | {n['policy_lag_students']:,} | {n['policy_lag_districts']:,} |", "",
             "Permitting states by students exposed:", "", "| state | law | covered | exposed | unmapped | policy lag |", "|---|---|---:|---:|---:|---:|"]
    for k in sc["permitting_states_by_exposure"][:12]:
        s = sc["states"][k]; lines.append(f"| {k} | {s['law']} | {s['covered']:,} | {s['exposed']:,} | {s['unmapped']:,} | {s['policy_lag_students']:,} |")
    return "\n".join(lines)

def targets_md(t):
    lines = ["| # | state | district | county | enrollment | status | policy lag | last move | next to |", "|---:|---|---|---|---:|---|---|---|---|"]
    for i, g in enumerate(t["ranked"][:10], 1):
        a = g["anchors"][0]; lm = g["last_move"]
        lines.append(f"| {i} | {g['state']} | {g['name']} | {g['county'] or '?'} | {g['enrollment'] or 0:,} | {g['status']} | {'yes' if g['policy_lag'] else ''} | {(lm['kind'] + ' ' + lm['sent_at'][:10]) if lm else 'none'} | {a['name']} ({a['basis'].replace('_', ' ')}{', same county' if a['same_county'] else ''}) |")
    return "\n".join(lines)

def main():
    sc = score_mod.main() if "-q" in sys.argv else score_mod.compute()
    if "-q" not in sys.argv: score_mod.write_json(score_mod.SCORE, sc); score_mod.append_jsonl(score_mod.HISTORY, [score_mod.history_line(sc)])
    rep = report_mod.compute(); open(report_mod.REPORT, "w").write(f"# Experiment report, {today()}\n\n{report_mod.table(rep)}")
    t = neighbors_mod.compute(); neighbors_mod.write_json(neighbors_mod.OUT, t)
    props = "(skipped: --no-llm)" if "--no-llm" in sys.argv else proposals(sc, rep, t)
    md = f"""# Safe Schools game: weekly review, {today()}

## Scoreboard

{scoreboard_md(sc)}

## Experiments

{report_mod.table(rep)}
## Next ten targets

{targets_md(t)}

## Proposed variants (PROPOSALS for Anthony to approve; nothing queued, nothing sent)

{props}

---
Files: data/game/score.json, data/game/report.md, data/game/next-targets.json, data/game/experiments.yaml. To approve a proposal, add it as a variant in experiments.yaml with `approved: false`; the first batch assigned to it queues held.
"""
    path = os.path.join(OUT, f"review-{today()}.md"); open(path, "w").write(md); print(path)
    return path

if __name__ == "__main__":
    main()
