#!/usr/bin/env bash
set -euo pipefail
root="${FYSO_ROOT:-$(pwd)}"
runtime="$root/.data/ext/discord"
source_dir="$root/extensions/discord"
mkdir -p "$runtime"
cp "$source_dir/package.json" "$source_dir/package-lock.json" "$runtime/"
unset DISCORD_BOT_TOKEN
export npm_config_cache="$runtime/npm-cache"
npm ci --prefix "$runtime" --omit=dev --ignore-scripts --no-audit --no-fund >&2
