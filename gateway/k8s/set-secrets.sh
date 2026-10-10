#!/bin/sh
# Put the values in gateway/k8s/.env into manul-secrets (see .env.example). Only non-empty values are written; every
# other key in the secret stays as it is. Values are never printed. Restarts the pods unless --no-restart.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
env_file="$here/.env"
[ -f "$env_file" ] || { echo "No $env_file: copy .env.example to .env and fill it in."; exit 1; }
kubectl -n manul get secret manul-secrets >/dev/null
patch=$(python3 - "$env_file" <<'PY'
import json, re, sys
data = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k, v = line.split('=', 1)
    k, v = k.strip().removeprefix('export '), v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in (chr(34), chr(39)): v = v[1:-1]  # "quoted" or 'quoted'
    if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', k) and v: data[k] = v
print(json.dumps({"stringData": data}) if data else '')
PY
)
[ -n "$patch" ] || { echo "Nothing to change: every value in .env is empty."; exit 0; }
printf '%s' "$patch" | kubectl -n manul patch secret manul-secrets --type merge --patch-file /dev/stdin >/dev/null
echo "Saved: $(printf '%s' "$patch" | python3 -c 'import json,sys; print(", ".join(sorted(json.load(sys.stdin)["stringData"])))')"
[ "${1:-}" = "--no-restart" ] && exit 0
kubectl -n manul rollout restart deploy/bifrost deploy/account
kubectl -n manul rollout status deploy/bifrost --timeout=180s
kubectl -n manul rollout status deploy/account --timeout=120s
