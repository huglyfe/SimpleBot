#!/bin/sh
# Source-checkout launch over the built CLI. Install and build explicitly.
set -eu

REPO=$(cd "$(dirname "$0")" && pwd)

exec node "$REPO/bin/simplebot.js" "$@"
