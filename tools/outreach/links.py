"""Tagged links for outreach. Each recipient gets a short token that maps back to the district and person, so a
click on earthpilot.org/kids/board/?r=<token> tells us who came, without putting a name or email in the URL.

  python3 links.py make <nces_id> <email> <campaign> [name]   -> prints the URL (idempotent)
  python3 links.py show <token>

Tokens live in data/outreach/links.jsonl. The secret is ESCP_LINK_SECRET in ~/.escp-deploy.env."""
import hashlib, hmac, json, os, sys, datetime
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
FILE = os.path.join(ROOT, "data/outreach/links.jsonl")
BASE = "https://earthpilot.org/kids/board/?r="

def secret():
    try:
        for l in open(os.path.expanduser("~/.escp-deploy.env")):
            if l.startswith("ESCP_LINK_SECRET="): return l.split("=", 1)[1].strip().strip('"')
    except FileNotFoundError: pass
    return "escp-links"

def load():
    if not os.path.exists(FILE): return {}
    return {json.loads(l)["token"]: json.loads(l) for l in open(FILE) if l.strip()}

def make(nces, email, campaign, name="", state=None):
    """The tagged link. With a state, it lands on that state's board page with the district id, so the page
    shows the district's own policy line; without one, the Texas page."""
    tok = hmac.new(secret().encode(), f"{nces}|{email.lower()}|{campaign}".encode(), hashlib.sha256).hexdigest()[:10]
    rows = load()
    if tok not in rows:
        with open(FILE, "a") as f:
            f.write(json.dumps({"token": tok, "nces_id": str(nces), "email": email, "name": name, "campaign": campaign, "made": datetime.datetime.now().isoformat(timespec="seconds")}) + "\n")
    if state: return f"https://earthpilot.org/kids/board/{state}/?r={tok}&d={nces}"
    return BASE + tok

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "make": print(make(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else ""))
    elif cmd == "show": print(json.dumps(load().get(sys.argv[2]), indent=1))
    else: print(__doc__)
