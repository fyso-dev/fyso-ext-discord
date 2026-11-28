#!/usr/bin/env bash
set -euo pipefail
root="${FYSO_ROOT:-$(pwd)}"
runtime="$root/.data/ext/discord"
source_dir="$root/extensions/discord"
mkdir -p "$runtime"
cp "$source_dir/package.json" "$source_dir/package-lock.json" "$runtime/"
unset DISCORD_BOT_TOKEN
marker="$runtime/.installed-package-lock.json"
# Skip a full reinstall when dependencies are already installed for this exact lockfile.
if [ -d "$runtime/node_modules" ] && cmp -s "$source_dir/package-lock.json" "$marker"; then
  exit 0
fi
rm -f "$marker"
export npm_config_cache="$runtime/npm-cache"
npm ci --prefix "$runtime" --omit=dev --ignore-scripts --no-audit --no-fund >&2
cp "$source_dir/package-lock.json" "$marker"
