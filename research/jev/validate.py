import json, os, subprocess, collections, concurrent.futures as cf

K=subprocess.run(["bash","-lc","grep -m1 OPENROUTER ~/personality-bench/.env.local | cut -d= -f2- | tr -d '\"'"],
                 capture_output=True,text=True).stdout.strip()
gold=json.load(open("/tmp/gold.json"))

CRITERIA={
 "allows":"Corporal punishment is permitted. This INCLUDES a policy a parent may opt OUT of by filing a written objection: the default is that it may be used unless a parent objects.",
 "bans":"Corporal punishment is prohibited, not permitted, shall not be used, or has been eliminated in this district.",
 "consent_required":"Corporal punishment may be used ONLY if a parent has first given affirmative permission. Opt-IN: the default is that it may NOT be used until a parent agrees.",
}

def ask(r):
    body={"model":"typesafe/jev-1.13",
      "state":{"district":f"{r['name']}, {r['state']}","policy_quote":r["quote"]},
      "questions":{"status":{"type":"choice",
        "instructions":"This is a sentence from a US school district's own discipline policy. What does it establish about corporal punishment in that district?",
        "criteria":CRITERIA}}}
    p=subprocess.run(["curl","-s","-m","60","https://openrouter.ai/api/alpha/decisions",
        "-H",f"Authorization: Bearer {K}","-H","Content-Type: application/json","-d",json.dumps(body)],
        capture_output=True,text=True)
    try:
        d=json.loads(p.stdout); a=d["answers"]["status"]
        return {**r,"jev":a["choice"],"conf":a["confidence"],"p":a["probabilities"],"cost":d["usage"]["cost"]}
    except Exception as e:
        return {**r,"jev":None,"err":p.stdout[:120]}

with cf.ThreadPoolExecutor(max_workers=8) as ex:
    res=list(ex.map(ask, gold))

ok=[r for r in res if r.get("jev")]
agree=[r for r in ok if r["jev"]==r["status"]]
cost=sum(r.get("cost",0) for r in ok)
print(f"{len(ok)}/{len(gold)} answered | agreement {len(agree)}/{len(ok)} = {100*len(agree)/len(ok):.1f}% | total cost ${cost:.4f}")

print("\nconfusion (human -> jev):")
c=collections.Counter((r["status"],r["jev"]) for r in ok)
for (h,j),n in sorted(c.items(), key=lambda kv:-kv[1]):
    print(f"   {h:18} -> {j:18} {n:4}{'   <-- DISAGREE' if h!=j else ''}")

dis=[r for r in ok if r["jev"]!=r["status"]]
print(f"\nagreement by confidence band:")
for lo,hi in [(0.99,1.01),(0.9,0.99),(0.7,0.9),(0,0.7)]:
    b=[r for r in ok if lo<=r["conf"]<hi]
    if b: print(f"   conf {lo}-{hi}: {len(b):4} records, {100*sum(1 for r in b if r['jev']==r['status'])/len(b):5.1f}% agree")
json.dump(res, open("/tmp/jevval.json","w"), indent=1)
print(f"\n{len(dis)} disagreements written to /tmp/jevval.json")
