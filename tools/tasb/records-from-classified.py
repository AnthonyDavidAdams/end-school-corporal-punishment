# classified.json -> records.json. The name is matched against the federal directory (unique match within the state);
# that says which district the finding is FOR. Whose document it is has to be proven separately: a document found by
# searching is recorded only when tools/tasb/identity.py has stamped the row (2026-11-11: five of six nightly records
# quoted another district's document, because the name match was the only check there was).
import json,csv,re,sys,datetime,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from identity import record_names
cls,out_path,method,code,note=sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],sys.argv[5]
STOP={'school','county','district','board','education','public','schools','the','of','city','municipal','consolidated','separate','independent','isd','cisd','inc','dist','sch','co','r','i','ii','iii','iv','v','vi','vii','viii','ix','x','xii'}
def tok(s): return frozenset(w for w in re.findall(r'[a-z0-9]+',(s or '').lower()) if w not in STOP)
def norm(s): return re.sub(r'[^a-z0-9 ]','',(s or '').lower().replace('mtn','mountain')).replace(' school district','').replace(' public schools','').replace(' schools','').strip()
dirr={}
for r in csv.DictReader(open('data/nces/lea-directory-2023-24.csv')):
    dirr.setdefault(norm(r['name']),[]).append((r['state'],r['nces_id'],r['name']))
out=[]; nomatch=[]; held=0; unproven=[]
ON_FILE=record_names()
for c in json.load(open(cls)):
    if c.get('decision')!='record': held+=1; continue
    ident=c.get('identity') or {}
    if method=='searched_document' and not ident.get('ok'): unproven.append(c['district']); continue
    cands=dirr.get(norm(c['district']),[])
    if c.get('_state'): cands=[x for x in cands if x[0]==c['_state']]  # never fall back to another state's district of the same name
    if len(cands)!=1:
        # fall back: token equality within the state
        t=tok(c['district']); cands=[x for k,v in dirr.items() for x in v if tok(x[2])==t and (not c.get('_state') or x[0]==c['_state'])]
    if len(cands)!=1: nomatch.append(c['district']); continue
    st,nces,_=cands[0]
    # The district may already be on file under a longer name ("Union County School District" for the directory's
    # "UNION"); a finding filed under the search name was added beside it as a second record. Use the name on file
    # when it is the same district's name, so the merge updates that record.
    name=c['district']; kept=ON_FILE.get(nces)
    if kept and tok(name) and (tok(name)<=tok(kept) or tok(kept)<=tok(name)) and tok(kept): name=kept
    out.append({"state":st,"name":name,"nces_id":nces,"status":c['status'],"parent_control":c.get('parent_control','unknown'),"source":c['source'],"quote":c['quote'],"quotes":c.get('quotes'),"policy_code":(c.get("policy_code") or code or None),"method":method,"last_verified":datetime.date.today().isoformat(),"notes":note+(f" Whose document: {ident['how']}." if ident.get('ok') else " Identity is name and state matched against the federal LEA directory.")})
json.dump(out,open(out_path,'w'),indent=1)
from collections import Counter
print(f'records {len(out)} | held {held} | no unique match {len(nomatch)}: {nomatch[:10]}'+(f' | REFUSED, document identity not proven: {unproven[:10]}' if unproven else '')); print(' ',Counter(o["status"] for o in out), Counter(o["state"] for o in out))
