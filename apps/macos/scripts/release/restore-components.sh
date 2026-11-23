#!/bin/bash
# Verify GitHub's digest of the exact ZIP before unpacking the component into the signing job.
set -euo pipefail
restore() {
  local kind=$1 descriptor=$2 id digest directory
  id=$(jq -er '.id | select(test("^[1-9][0-9]*$"))' <<< "$descriptor")
  digest=$(jq -er '.digest | select(test("^[0-9a-f]{64}$"))' <<< "$descriptor")
  SOURCE_SHA=$(jq -er '.source | select(test("^[0-9a-f]{40}$"))' <<< "$descriptor")
  COMPONENT_KEY=$(jq -er '.key | select(test("^[0-9a-f]{64}$"))' <<< "$descriptor")
  export SOURCE_SHA COMPONENT_KEY
  directory=$(mktemp -d "$RUNNER_TEMP/restore-$kind.XXXXXX")
  gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$id/zip" > "$directory/github.zip"
  printf '%s  %s\n' "$digest" "$directory/github.zip" | shasum -a 256 -c -
  for entry in receipt.json component.tar.gz; do
    unzip -p "$directory/github.zip" "$entry" > "$directory/$entry"
  done
  bash apps/macos/scripts/release/component-handoff.sh restore "$kind" "$directory"
  rm -rf "$directory"
}
restore native "$NATIVE_COMPONENT"
restore service "$SERVICE_COMPONENT"
