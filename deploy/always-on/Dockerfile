# The always-on engine: the outreach cycle, the nightly harvest, the recap and the game score, scheduled by
# deploy/always-on/scheduler.py in one container. Build from the repository root:
#   docker build -f deploy/always-on/Dockerfile -t escp-engine .
# Railway: builder DOCKERFILE with dockerfilePath deploy/always-on/Dockerfile (see railway.toml beside this
# file), a volume mounted at /data, and the variables listed in RUNBOOK.md. See INVENTORY.md for why each
# system package is here.
#
# The image is the runtime only. The repository itself is cloned onto the volume at first boot and
# fast-forwarded from origin/main before every cycle, so code and data changes pushed from the laptop are live
# without a rebuild. Rebuild when package-lock.json, tools/package-lock.json or anything in deploy/always-on
# changes (railway.toml's watchPatterns say exactly that).

# Playwright's own image: Ubuntu 24.04, Node 22, and the Chromium build that matches the playwright version in
# package-lock.json (1.63.0). Certificates (tools/certificates/make.mjs, run by every cycle), the NC portal
# harvester and the walled-site reader in the nightly all need it.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV DEBIAN_FRONTEND=noninteractive TZ=America/Chicago LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv \
      git zsh rsync openssh-client sshpass ca-certificates curl tzdata \
      poppler-utils ocrmypdf tesseract-ocr tesseract-ocr-eng antiword \
    && rm -rf /var/lib/apt/lists/*
# pdftotext/pdfinfo: poppler-utils.  OCR of scanned handbooks: ocrmypdf + tesseract.  .doc files: antiword
# (the textutil shim).  zsh: tools/nightly/run-jev.sh and tools/portals/nightly.sh are zsh scripts.
# sshpass + rsync + ssh: the site deploy to DreamHost, and the tagged-link click fetch.

# Python packages the scheduled scripts import (PyYAML, qrcode, python-docx) plus Pillow for the certificate PNG.
RUN pip3 install --no-cache-dir --break-system-packages pyyaml qrcode python-docx pillow

# tools/nightly/run-jev.sh calls /opt/homebrew/bin/python3 by its Homebrew path.
RUN mkdir -p /opt/homebrew/bin && ln -s /usr/bin/python3 /opt/homebrew/bin/python3

WORKDIR /app
COPY package.json package-lock.json ./
COPY tools/package.json tools/package-lock.json ./tools/
RUN npm ci --omit=dev --no-audit --no-fund && npm ci --omit=dev --no-audit --no-fund --prefix tools

# The scheduler, the notify path, the dead-man check and the three shims (osascript, textutil, claude).
COPY deploy/always-on/ /app/
RUN chmod +x /app/entrypoint.sh /app/bin/* /app/scheduler.py /app/deadman.py /app/notify.py

ENV PATH=/app/bin:/usr/local/bin:/usr/bin:/bin \
    HOME=/root \
    ESCP_REPO=/data/repo \
    ESCP_WRITER=openrouter \
    ESCP_NOTIFY=smtp \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

VOLUME ["/data"]
ENTRYPOINT ["/app/entrypoint.sh"]
