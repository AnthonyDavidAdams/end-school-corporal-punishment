#!/bin/bash
# Validate, rebuild, deploy, commit, push. Used by the outreach job and by hand. $1 = commit message.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
(cd tools && node fill-county.mjs >/dev/null && node validate.mjs | tail -1 | grep -q "0 failures") || { echo "validation failed; not publishing"; exit 1; }
npm --prefix tools run build-site 2>&1 | tail -1
git add data/districts data/policies data/outreach/requests.json site >/dev/null 2>&1
git commit -q -m "${1:-Update the record}

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push -q origin main && echo "pushed"
if [ -f "$HOME/.escp-deploy.env" ]; then source "$HOME/.escp-deploy.env"; sshpass -p "$DEPLOY_PASS" rsync -az --delete --exclude og.html --exclude news.php --exclude icon.php -e "ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no" site/ "$DEPLOY_HOST:$DEPLOY_PATH" && echo "deployed"; fi
