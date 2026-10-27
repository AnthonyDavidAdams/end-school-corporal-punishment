#!/bin/bash
# Container start for the always-on engine. Three jobs: turn the service's environment into the files the
# pipeline scripts read from $HOME, make git able to push, and make sure the repository is on the volume.
# Then hand over to scheduler.py. Nothing here prints a secret.
set -euo pipefail

REPO=${ESCP_REPO:-/data/repo}
REMOTE=${ESCP_GIT_REMOTE:-https://github.com/AnthonyDavidAdams/end-school-corporal-punishment.git}
export HOME=${HOME:-/root}

missing=0
for v in IMAP_USER IMAP_PASSWORD OPENROUTER_API_KEY GITHUB_TOKEN; do
  if [ -z "${!v:-}" ]; then echo "entrypoint: required variable $v is not set" >&2; missing=1; fi
done
for v in BRAVE_API_KEY DEPLOY_PASS ESCP_MAINTAINER_TOKEN SMS_RECIPIENT; do
  [ -n "${!v:-}" ] || echo "entrypoint: optional variable $v is not set (feature degrades, see INVENTORY.md)"
done
[ "$missing" = 0 ] || exit 64

# 1. The $HOME files. The scripts open these by path; a few open them without an existence check, so the
#    two the cycle cannot start without are always written. Mode 600, on the container's own disk, not the volume.
umask 077
mkdir -p "$HOME/inbox-brief" "$HOME/personality-bench"
printf 'IMAP_USER=%s\nIMAP_PASSWORD=%s\nSMS_RECIPIENT=%s\n' "$IMAP_USER" "$IMAP_PASSWORD" "${SMS_RECIPIENT:-}" > "$HOME/inbox-brief/config.env"
printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_API_KEY" > "$HOME/personality-bench/.env.local"
printf 'SMS_RECIPIENT=%s\n' "${SMS_RECIPIENT:-}" > "$HOME/.escp-outreach.env"
if [ -n "${BRAVE_API_KEY:-}" ]; then printf 'BRAVE_API_KEY=%s\n' "$BRAVE_API_KEY" > "$HOME/.brave.env"; fi
if [ -n "${DEPLOY_PASS:-}" ]; then
  printf 'DEPLOY_PASS=%s\nDEPLOY_HOST=%s\nDEPLOY_PATH=%s\nCOACH_SALT=%s\nESCP_LINK_SECRET=%s\n' \
    "$DEPLOY_PASS" "${DEPLOY_HOST:-}" "${DEPLOY_PATH:-}" "${COACH_SALT:-}" "${ESCP_LINK_SECRET:-}" > "$HOME/.escp-deploy.env"
fi
if [ -n "${ESCP_MAINTAINER_TOKEN:-}" ]; then printf 'ESCP_MAINTAINER_TOKEN=%s\n' "$ESCP_MAINTAINER_TOKEN" > "$HOME/.escp-maintainer.env"; fi
umask 022

# 2. git: identity, and a credential helper that reads the token from the environment at push time, so the
#    token is never written to .git/config on the volume.
git config --global user.name "${GIT_AUTHOR_NAME:-Anthony David Adams}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-a@175g.com}"
git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'
git config --global --add safe.directory "$REPO"
git config --global pull.ff only

# 3. The repository on the volume. First boot clones it (public repo); later boots reuse it.
mkdir -p "$(dirname "$REPO")"
if [ ! -d "$REPO/.git" ]; then
  echo "entrypoint: cloning $REMOTE into $REPO"
  git clone -q "$REMOTE" "$REPO"
fi
cd "$REPO"
# Dependencies live in the image; the clone sees them through symlinks (both paths are gitignored).
ln -sfn /app/node_modules "$REPO/node_modules"
ln -sfn /app/tools/node_modules "$REPO/tools/node_modules"
# The cycle runs the certificate sender as tools/.venv/bin/python; the venv is gitignored, so point it at the
# system interpreter, which has the same packages installed (see the Dockerfile).
mkdir -p "$REPO/tools/.venv/bin"; ln -sfn "$(command -v python3)" "$REPO/tools/.venv/bin/python"
mkdir -p out/outreach out/nightly out/social out/game out/portals out/certificates/sent out/briefs data/outreach/replies data/policies/inbound
chmod +x tools/nightly/*.sh tools/portals/*.sh tools/publish.sh 2>/dev/null || true

echo "entrypoint: $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD); $(git status --porcelain | wc -l | tr -d ' ') uncommitted paths; node $(node --version); python $(python3 --version | cut -d' ' -f2); tz ${TZ:-unset}"
exec python3 /app/scheduler.py
