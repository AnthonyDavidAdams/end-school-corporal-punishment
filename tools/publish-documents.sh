#!/bin/bash
# Push the originals archive (data/documents/, outside git) to the site at /kids/documents/. Additive:
# nothing on the server is deleted, so a document captured once stays published even if the record
# later drops the citation.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[ -f "$HOME/.escp-deploy.env" ] || { echo "no deploy env"; exit 1; }
source "$HOME/.escp-deploy.env"
sshpass -p "$DEPLOY_PASS" rsync -az -e "ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no" data/documents/ "$DEPLOY_HOST:${DEPLOY_PATH}documents/" && echo "documents published: $(find data/documents -type f ! -name manifest.json | wc -l | tr -d ' ') files"
