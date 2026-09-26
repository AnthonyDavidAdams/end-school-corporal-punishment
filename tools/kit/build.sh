#!/bin/bash
# The Safe Discipline Program kit: seven markdown documents -> one HTML page (site/kit/) -> one PDF (kit/safe-discipline-program.pdf).
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
ORDER="README 01-model-policy 02-board-motion 03-announcement-staff 04-announcement-parents 05-announcement-students 06-history 07-training-transition-alternatives"
: > "$TMP/body.html"
for f in $ORDER; do
  # every document starts on a new page; relative links in the repo become plain text on paper
  sed -E 's#\[([^]]+)\]\([0-9]{2}-[a-z-]+\.md\)#\1#g; s#\[([^]]+)\]\(\.\./[^)]+\)#\1#g; s#`\.\./training/modules/`#the training modules#g; s#`\.\./training/evidence\.md`#the evidence base#g; s#`\.\./facts/claims/`#the facts registry#g; s#`\.\./facts/README\.md`#the facts registry index#g; s#`\.\./training/modules/([0-9]+)-[a-z-]+\.md`#Module \1#g; s#`\.\./templates/[a-z-]+\.md`#the templates#g' "kit/$f.md" | pandoc --from gfm --to html5 --wrap=none >> "$TMP/body.html"
  echo '<div class="pagebreak"></div>' >> "$TMP/body.html"
done
cat > "$TMP/final.html" <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Safe Discipline Program kit — End School Corporal Punishment</title>
<meta name="description" content="Everything a district needs to end corporal punishment well: the policy, the board motion, the words for staff, families and students, the history, the training and the ninety-day transition. An in-kind grant from EarthPilot.org.">
<meta property="og:title" content="The Safe Discipline Program kit"><meta property="og:description" content="The policy, the motion, the words for staff, families and students, the history, the training and the transition. Free, as an in-kind grant from EarthPilot.org."><meta property="og:image" content="https://earthpilot.org/kids/assets/og-image.png"><meta property="og:url" content="https://earthpilot.org/kids/kit/"><meta property="og:type" content="article"><meta property="og:site_name" content="End School Corporal Punishment">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="The Safe Discipline Program kit"><meta name="twitter:description" content="The policy, the motion, the words for staff, families and students, the history, the training and the transition."><meta name="twitter:image" content="https://earthpilot.org/kids/assets/og-image.png">
<style>
@page{size:Letter;margin:0.9in 0.9in 1in}
:root{--ink:#1B2A41;--muted:#5E6A8A;--rule:#D9DCE3;--accent:#9B2C2C}
html{font-size:15px}body{margin:0;color:var(--ink);font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;line-height:1.5;background:#fff}
.page{max-width:44rem;margin:0 auto;padding:2rem 1.25rem 4rem}
.masthead{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid var(--ink);padding-bottom:.5rem;margin-bottom:2.5rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.masthead b{font-size:1.05rem;letter-spacing:.02em}.masthead span{color:var(--muted);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase}
.cover{margin:3rem 0 5rem}.cover .k{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700}
.cover h1{font-size:2.6rem;line-height:1.1;margin:.4rem 0 .8rem;font-weight:600;letter-spacing:-.01em}.cover p{font-size:1.1rem;max-width:36rem;color:var(--ink)}.cover .meta{color:var(--muted);font-size:.9rem;margin-top:2rem}
h1{font-size:1.9rem;line-height:1.15;margin:0 0 .6rem;font-weight:600;letter-spacing:-.01em}
h2{font-size:1.25rem;margin:2rem 0 .5rem;font-weight:600;border-bottom:1px solid var(--rule);padding-bottom:.25rem}
h3{font-size:1.05rem;margin:1.4rem 0 .4rem;font-weight:600}
p{margin:.6rem 0}ul,ol{padding-left:1.4rem}li{margin:.25rem 0}
blockquote{margin:1rem 0;padding:.2rem 0 .2rem 1.1rem;border-left:3px solid var(--accent);color:var(--ink)}
pre{white-space:pre-wrap;font-family:"IBM Plex Mono",Menlo,Consolas,monospace;font-size:.82rem;line-height:1.45;background:#F5F6F8;border:1px solid var(--rule);padding:1rem 1.1rem;border-radius:4px}
code{font-family:"IBM Plex Mono",Menlo,Consolas,monospace;font-size:.85em;background:#F5F6F8;padding:.05em .3em;border-radius:3px}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;font-size:.88rem;margin:.8rem 0}th,td{text-align:left;vertical-align:top;padding:.45rem .55rem;border-bottom:1px solid var(--rule)}th{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
a{color:var(--accent)}hr{border:0;border-top:1px solid var(--rule);margin:2rem 0}
.pagebreak{page-break-after:always;break-after:page;height:0}
.foot{margin-top:3rem;padding-top:.8rem;border-top:1px solid var(--rule);color:var(--muted);font-size:.8rem;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
@media print{.page{max-width:none;padding:0}h2,h3{page-break-after:avoid}pre,blockquote,table{page-break-inside:avoid}}
</style></head><body><div class="page">
<div class="masthead"><b>EarthPilot · End School Corporal Punishment</b><span>earthpilot.org/kids</span></div>
<div class="cover"><div class="k">An in-kind grant from EarthPilot.org</div><h1>The Safe Discipline Program kit</h1><p>Everything a district needs to end corporal punishment well: the policy, the motion, the words for staff, families and students, the history, the training, and the ninety days between the vote and the change.</p><p class="meta">Version $(date +%Y-%m-%d) · Every figure carries the id of a verified claim in the project's facts registry · Free to use and adapt (CC BY 4.0) · Built with Ground Crew</p></div>
<div class="pagebreak"></div>
$(cat "$TMP/body.html")
<div class="foot">The Safe Discipline Program · EarthPilot · earthpilot.org/kids · The coach that answers questions about this kit is at galley.so/safe-discipline</div>
</div></body></html>
HTML
cp "$TMP/final.html" site/kit/index.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$PWD/kit/safe-discipline-program.pdf" --virtual-time-budget=10000 "file://$TMP/final.html" 2>/dev/null
cp kit/safe-discipline-program.pdf site/kit/safe-discipline-program.pdf
echo "html $(wc -c < site/kit/index.html) bytes; pdf $(wc -c < kit/safe-discipline-program.pdf) bytes, $(pdfinfo kit/safe-discipline-program.pdf 2>/dev/null | grep Pages)"
