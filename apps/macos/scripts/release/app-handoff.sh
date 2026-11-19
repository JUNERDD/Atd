#!/bin/bash
# GitHub artifact ZIPs discard file modes. Wrap the bundle in a ditto archive and
# bind its bytes and the verified add-ons to this run's source and architecture.
set -euo pipefail
source_id="${GITHUB_RUN_ID:?} ${GITHUB_SHA:?} ${RELEASE_ARCH:?} ${VERSION:?} ${BUILD_VERSION:?}"
[ "$(git rev-parse HEAD)" = "$GITHUB_SHA" ]
case "$1" in
  archive)
    app=$2 addons=$3 handoff=$4
    mkdir -p "$handoff"
    ditto -c -k --keepParent --sequesterRsrc "$app" "$handoff/Atd.app.zip"
    cp "$addons"/{addons.lock.json,Atd-addon-*.tar.gz} "$handoff/"
    echo "$source_id" > "$handoff/source"
    (cd "$handoff" && shasum -a 256 Atd.app.zip addons.lock.json Atd-addon-*.tar.gz > SHA256SUMS)
    ;;
  restore)
    handoff=$2 dest=$3
    [ "$(cat "$handoff/source")" = "$source_id" ]
    (cd "$handoff" && shasum -a 256 -c SHA256SUMS)
    mkdir -p "$dest"
    ditto -x -k "$handoff/Atd.app.zip" "$dest"
    app="$dest/Atd.app"
    [ "$(lipo -archs "$app/Contents/MacOS/Atd")" = "${RELEASE_MACHINE:?}" ]
    [ "$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")" = "$VERSION" ]
    [ "$(plutil -extract CFBundleVersion raw "$app/Contents/Info.plist")" = "$BUILD_VERSION" ]
    codesign --verify --deep --strict "$app"
    cmp "$app/Contents/Resources/agent-service/addons.lock.json" "$handoff/addons.lock.json"
    echo "APP=$app" >> "${GITHUB_ENV:?}"
    ;;
  *) exit 2 ;;
esac
