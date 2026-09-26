# classified.json -> records.json, identity by name against the federal directory (unique match, any state)
import json,csv,re,sys
cls,out_path,method,code,note=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5]
STOP={'school','county','district','board','education','public','schools','the','of','city','municipal','consolidated','separate','independent','isd','cisd','inc','dist','sch','co','r','i','ii','iii','iv','v','vi','vii','viii','ix','x','xii'}
def tok(s): return frozenset(w for w in re.findall(r'[a-z0-9]+',(s or '').lower()) if w not in STOP)
def norm(s): return re.sub(r'[^a-z0-9 ]','',(s or '').lower().replace('mtn','mountain')).replace(' school district','').replace(' public schools','').replace(' schools','').strip()
dirr={}
for r in csv.DictReader(open('data/nces/lea-directory-2023-24.csv')):
    dirr.setdefault(norm(r['name']),[]).append((r['state'],r['nces_id'],r['name']))
out=[]; nomatch=[]; held=0
for c in json.load(open(cls)):
    if c.get('decision')!='record': held+=1; continue
    cands=dirr.get(norm(c['district']),[])
    if c.get('_state'): cands=[x for x in cands if x[0]==c['_state']]  # never fall back to another state's district of the same name
    if len(cands)!=1:
        # fall back: token equality within the state
        t=tok(c['district']); cands=[x for k,v in dirr.items() for x in v if tok(x[2])==t and (not c.get('_state') or x[0]==c['_state'])]
    if len(cands)!=1: nomatch.append(c['district']); continue
    st,nces,_=cands[0]
    out.append({"state":st,"name":c['district'],"nces_id":nces,"status":c['status'],"parent_control":c.get('parent_control','unknown'),"source":c['source'],"quote":c['quote'],"quotes":c.get('quotes'),"policy_code":code,"method":method,"last_verified":"2026-09-25","notes":note+" Identity is name and state matched against the federal LEA directory."})
json.dump(out,open(out_path,'w'),indent=1)
from collections import Counter
print(f'records {len(out)} | held {held} | no unique match {len(nomatch)}: {nomatch[:10]}'); print(' ',Counter(o["status"] for o in out), Counter(o["state"] for o in out))
