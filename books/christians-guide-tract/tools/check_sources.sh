#!/bin/sh
# Every id named in a \spreadSource{} line must be a file in facts/claims/. Exit 1 otherwise.
cd "$(dirname "$0")/.." || exit 1
fail=0
for id in $(grep -oh 'spreadSource{[^}]*}' 02-chapters/*.md | sed 's/spreadSource{//; s/}//' | tr ';' '\n' | tr -d ' ' | grep . | sort -u); do
  [ -f "../../facts/claims/$id.md" ] || { echo "missing claim file: $id"; fail=1; }
done
grep -n "—" 02-chapters/*.md && { echo "em dash found"; fail=1; }
[ $fail -eq 0 ] && echo "sources ok"
exit $fail
