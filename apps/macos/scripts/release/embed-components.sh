#!/bin/bash
# Both the Xcode Release build and the hosted component assembly embed the same staged inputs.
set -euo pipefail
resources=${1:?Expected the app Resources directory.}
repo="$(cd "$(dirname "$0")/../../../.." && pwd)"
renderer="$repo/apps/desktop/dist-native"
service="$repo/tmp/t7-agent-service-pack"
node="$repo/tmp/t7-node"
for required in "$renderer/index.html" "$service/dist/cli.js" "$service/build-info.json" "$node/bin/node"; do
  if [ ! -e "$required" ]; then
    echo "error: $required is missing. Run pnpm --filter @atd/macos bundle first." >&2
    exit 1
  fi
done
rsync -a --delete "$renderer/" "$resources/renderer/"
rsync -a --delete --exclude .tsbuildinfo "$service/" "$resources/agent-service/"
rsync -a --delete "$node/" "$resources/node/"
