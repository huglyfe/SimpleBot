#!/bin/sh
# The one supported development launch.
#
# Never runs against the repository root: `data/` there is live. Everything is
# seeded into a disposable root, pairing is disabled so no certificate or
# pairing code is needed, and the server is stopped by its captured PID.
#
#   ./dev.sh                      # disposable root at .dev-root, ports 3100/5199
#   SIMPLEBOT_DEV_ROOT=/tmp/scdev SIMPLEBOT_PORT=3000 WEB_PORT=5173 ./dev.sh
set -eu

REPO=$(cd "$(dirname "$0")" && pwd)
ROOT=${SIMPLEBOT_DEV_ROOT:-$REPO/.dev-root}
PORT=${SIMPLEBOT_PORT:-3100}
WEB_PORT=${WEB_PORT:-5199}

(umask 077; mkdir -p "$ROOT")
ROOT=$(cd "$ROOT" && pwd)
if [ "$ROOT" = "$REPO" ]; then
  printf '%s\n' 'Development requires a separate disposable root.' >&2
  exit 1
fi

# A development root pairs freely and keeps the operator's own keys out of it,
# other than the provider credential the launch environment already exposes.
if [ ! -f "$ROOT/config.json" ]; then
  node -e '
    const { readFileSync, writeFileSync } = require("node:fs");
    const config = JSON.parse(readFileSync(process.argv[1], "utf8"));
    config.application.loginEnabled = false;
    writeFileSync(process.argv[2], `${JSON.stringify(config, null, 2)}\n`);
  ' "$REPO/server/defaults/config.example.json" "$ROOT/config.json"
fi

(cd "$REPO" && pnpm build)

SIMPLEBOT_ROOT="$ROOT" SIMPLEBOT_PORT="$PORT" \
  node "$REPO/bin/simplebot.js" start >"$ROOT/server.log" 2>&1 &
SERVER_PID=$!
printf '%s\n' "$SERVER_PID" >"$ROOT/server.pid"
# Stop only the PID captured at spawn: other checkouts may be running too.
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

if ! node --input-type=module --eval '
  const url = process.argv[1];
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) process.exit(0);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.exit(1);
' "http://127.0.0.1:$PORT/api/health"; then
  cat "$ROOT/server.log"
  exit 1
fi

printf 'server pid %s on :%s (log: %s)\n' "$SERVER_PID" "$PORT" "$ROOT/server.log"
printf 'client http://127.0.0.1:%s/\n' "$WEB_PORT"

cd "$REPO/web"
CONFIG_PATH="$ROOT/config.json" SIMPLEBOT_PORT="$PORT" \
  pnpm dev --port "$WEB_PORT"
