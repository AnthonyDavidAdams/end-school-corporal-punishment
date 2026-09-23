#!/bin/zsh
# Reads a proxy list from ~/.proxies.env and sets it on the Railway service, without the credentials
# ever appearing in a transcript, a commit, or a shell history line.
#
# Put this in ~/.proxies.env (chmod 600), one line:
#   EGRESS_PROXIES=http://user:pass@host:port,http://user:pass@host:port
#
# Then: ./tools/set-egress-proxies.sh
set -e
FILE="${HOME}/.proxies.env"
[ -f "$FILE" ] || { echo "No $FILE. Put EGRESS_PROXIES=... in it first."; exit 1; }
export $(grep -v '^#' "$FILE" | xargs)
[ -n "$EGRESS_PROXIES" ] || { echo "$FILE has no EGRESS_PROXIES line."; exit 1; }
COUNT=$(echo "$EGRESS_PROXIES" | tr ',' '\n' | grep -c .)
echo "setting $COUNT proxies on escp-mcp"
railway variables --service escp-mcp --set "EGRESS_PROXIES=$EGRESS_PROXIES" >/dev/null
echo "set. Railway will redeploy; then check:"
echo "  curl -s https://escp-mcp-production.up.railway.app/healthz | grep egress_proxies"
