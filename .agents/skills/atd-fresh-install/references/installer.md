# Installer preparation and verification

Resolve the version, download path, and commit for each invocation. Do not reuse fixed values from an earlier reset.

## Obtain an official artifact

The project repository is `JUNERDD/Atd`. Release automation lives in `.github/workflows/release.yml`; stable download mirroring lives in `.github/workflows/mirror-release.yml`. Check the current configuration before relying on these details.

- Use the requested version, or the latest published stable GitHub release when none is specified. Exclude drafts and prereleases unless explicitly requested.
- The installer is normally `Atd-<version>-arm64.dmg`. Verify machine architecture and the release's supported macOS version. A local Debug build is not an official installer.
- Use `gh release view --repo JUNERDD/Atd` / `gh api` for the actual tag, commit, and asset metadata, then `gh release download` into the user's Downloads directory. Do not expose tokens or overwrite an unrelated existing file.
- When publication is explicitly part of the request, wait for the release and mirror verification, and confirm the tag points to the merged release commit. Follow project PR and validation rules; this skill does not grant additional publication authority.

## Verify the installer

1. Compare local file size and SHA-256 with the GitHub asset's `size` and `digest`. If the upstream digest is absent, disclose that limitation and use available official verification evidence rather than inventing a checksum.
2. Run `hdiutil verify`. Mount read-only without browsing: `hdiutil attach -readonly -nobrowse -plist`. Parse the returned mount point instead of assuming its name.
3. Read `Atd.app/Contents/Info.plist` inside the volume. Check `CFBundleIdentifier=com.junerdd.ai`, `CFBundleShortVersionString`, and `CFBundleVersion` against the selected release.
4. Run `codesign --verify --deep --strict` on the actual packaged app. Always detach this task's verification mount, including on failure.
5. Preserve download quarantine. Normal browser downloads generally have it; inspect `com.apple.quarantine` after a CLI download. If absent, compile and run this skill's `scripts/quarantine.swift` from a task temporary directory to add download metadata through Foundation. Never remove quarantine or bypass Gatekeeper.

```sh
# Run from the repository root. Variables point to this task's helper and verified installer.
xcrun swiftc .agents/skills/atd-fresh-install/scripts/quarantine.swift \
  -o "$quarantine_helper"
"$quarantine_helper" "$installer_path"
```

If Swift compilation tools are unavailable, use a normal browser download and verify quarantine. Do not install developer tools or change global configuration just for this step.

Passing strict signature verification does not establish Developer ID signing or Apple notarization. Explain first-open requirements using the selected release's actual signing status.

## Known packaging failure

`resource fork, Finder information, or similar detritus not allowed` previously resulted from a DMG `hide_extensions` setting: it added `com.apple.FinderInfo` after app signing, and the attribute survived copying to disk.

On artifact verification failure, preserve production data and report the release artifact issue. Removing downloaded attributes, re-signing the app, or using only a less strict check does not validate the original release. Fix packaging and republish only within an existing repair/publication authorization, then verify the new official artifact.

## Leave installation to the user

Do not copy the new app into Applications, launch it, mark onboarding complete, or pre-grant permissions. Deliver the verified DMG so the user can open it, drag the app into Applications, follow macOS first-open requirements, and launch it themselves. To eject an old installer, first identify its image-path and version through `hdiutil info -plist`; detach only that volume.
