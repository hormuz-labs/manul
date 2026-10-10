#!/bin/sh
# Fill in manul-secrets interactively: asks for each key (typing is hidden), skips any left empty, then restarts the
# pods. Values are never printed or written to disk.
set -eu
keys="CLERK_SECRET_KEY DODO_API_KEY DODO_WEBHOOK_SECRET ANTHROPIC_API_KEY GEMINI_API_KEY OPENAI_API_KEY"
kubectl -n manul get secret manul-secrets >/dev/null
json='{"stringData":{'
sep=''
for k in $keys; do
  printf '%s (Enter to skip): ' "$k"
  stty -echo; read -r v; stty echo; echo
  [ -z "$v" ] && continue
  esc=$(printf '%s' "$v" | sed 's/\\/\\\\/g; s/"/\\"/g')
  json="$json$sep\"$k\":\"$esc\""
  sep=','
done
json="$json}}"
[ -z "$sep" ] && { echo "Nothing to change."; exit 0; }
kubectl -n manul patch secret manul-secrets -p "$json" >/dev/null && echo "Saved."
kubectl -n manul rollout restart deploy/bifrost deploy/account
kubectl -n manul rollout status deploy/bifrost --timeout=180s
kubectl -n manul rollout status deploy/account --timeout=120s
