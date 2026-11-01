# Diagnostic download channel

This publisher stays on `debug`. The website's `/debug` and `/zh/debug` routes are implemented
separately from `main`; they read `https://downloads.atd.best/debug/manifest.json` through their
same-origin `/downloads/debug.json` proxy. Never merge diagnostic infrastructure into `main`.

The diagnostic release workflow builds and verifies both signed installers, adds the selected
`diagnosticProfile` to its artifact manifest, and invokes `publish.mjs` after successful collection.
It uses the existing R2 download credentials and upload/read-back helpers. Publication rejects
other refs, automatic events, missing profiles, source-commit mismatches and non-diagnostic versions.

Only `debug/builds/<commit>/<version>/Atd-<version>-<arch>.dmg` and `debug/manifest.json` are written,
plus any missing immutable, content-addressed add-ons already required by the packaged app.
Stable/preview manifests, update feeds and GitHub Releases are untouched. All installers and add-ons
pass public size/header/range/digest checks before the single manifest pointer advances. The
manifest caches for 60 seconds and names immutable downloads, so an older page still downloads
its displayed version. Failed uploads leave the previous manifest in place. Existing build files
are retained for reports that already link to them.

The public schema is version 1: `channel: debug`, `version`, `buildVersion`, `revision`,
`profile` (`runtime` or `focus`), `publishedAt`, and `architectures` keyed by `arm64` and `x64`.
Each architecture contains `url`, `sha256`, `bytes` and `minMacOS`. No user logs are published.
The page treats 404 as no available build; malformed manifests and network failures show an error
with a retry action. It never falls back to a stable or preview installer under a debug label.

After downloading a workflow artifact, local read-only verification is:

```sh
node ops/debug-downloads/publish.mjs --source-dir <artifact-directory> --dry-run
```

Publishing is automatic only after a successful manual artifact build on `debug`. Use a new
version suffix for each package, verify the actual package and report as AGENTS.md requires,
and send the reporter the page link together with the version they should use.
