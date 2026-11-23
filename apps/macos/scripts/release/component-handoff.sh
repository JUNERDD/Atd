#!/bin/bash
# GitHub artifact ZIPs discard executable modes. macOS bsdtar preserves the actual
# trees, including pnpm and framework symlinks, hard links, xattrs and signatures.
set -euo pipefail

fail() { echo "component-handoff: $*" >&2; exit 1; }
[[ $# = 3 ]] || fail 'usage: component-handoff.sh archive|restore native|service DIR'
action=$1 kind=$2 handoff=$3
case "$action" in archive|restore) ;; *) fail "unknown operation $action";; esac
case "$kind" in
  native) parent=apps/macos/DerivedData/Build/Products/Release; roots=(Atd.app);;
  service) parent=tmp; roots=(t7-agent-service-pack t7-node addons-release);;
  *) fail "unknown component $kind";;
esac

repo=$(cd "$(git rev-parse --show-toplevel)" && pwd -P)
check="$repo/apps/macos/scripts/release/component-check.mjs"
[[ $(git -C "$repo" rev-parse HEAD) = "${GITHUB_SHA:?}" ]] || fail 'checkout does not match GITHUB_SHA'
# Restore only to the named output trees inside the checkout, including on a retry.
base="$repo"
IFS=/ read -ra parts <<< "$parent"
for part in "${parts[@]}"; do
  base="$base/$part"
  [[ ! -L "$base" ]] || fail "linked output directory $base"
  if [[ "$action" = restore && ! -d "$base" ]]; then mkdir "$base"; fi
done
if [[ "$action" = archive ]]; then mkdir -p "$handoff"; fi
handoff=$(cd "$handoff" && pwd -P)
for root in "${roots[@]}"; do
  case "$handoff/" in "$base/$root/"*) fail 'handoff directory is inside the payload';; esac
done

if [[ "$action" = archive ]]; then
  [[ -z "$(ls -A "$handoff")" ]] || fail 'handoff directory must be empty'
  node "$check" tree "$kind" "$base"
  tar --options gzip:compression-level=1 -czf "$handoff/component.tar.gz" -C "$base" "${roots[@]}"
  node "$check" record "$kind" "$handoff"
  exit
fi

node "$check" receipt "$kind" "$handoff"
# Extract only in a fresh directory. bsdtar's default secure extraction rejects
# traversals and writes through symlinks. Validate the complete trees before swapping them in.
stage=$(mktemp -d "$base/.restore-$kind.XXXXXXXX")
backup="$stage/previous"
cleanup() {
  status=$?
  if [[ $status != 0 && -d "$backup" ]]; then
    for root in "${roots[@]}"; do
      if [[ ! -d "$stage/new/$root" ]]; then rm -rf "${base:?}/${root:?}"; fi
      if [[ -e "$backup/$root" || -L "$backup/$root" ]]; then mv "$backup/$root" "$base/$root"; fi
    done
  fi
  rm -rf "$stage"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
mkdir "$stage/new"
tar -xzpf "$handoff/component.tar.gz" -C "$stage/new"
node "$check" tree "$kind" "$stage/new" --exact-roots
mkdir "$backup"
for root in "${roots[@]}"; do
  if [[ -e "$base/$root" || -L "$base/$root" ]]; then mv "$base/$root" "$backup/$root"; fi
  mv "$stage/new/$root" "$base/$root"
done
