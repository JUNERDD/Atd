# Intel macOS 15 Release smoke tests

The x64 row of `release.yml`'s existing `verify` job runs this suite on
`macos-15-intel`, after verifying and copying the existing `dmg-x64` artifact.
It uses that app's bundled Node and launches that exact Release app through
LaunchServices. It does not rebuild, re-sign or alter the app, grant permissions,
remove quarantine, or use Rosetta. A failed required assertion fails `verify`,
which prevents its dependent `collect` and publication jobs from running.

Each launch passes `-SUEnableAutomaticChecks NO -SUAutomaticallyUpdate NO` as
volatile UserDefaults arguments, so a background update cannot replace the
candidate between launch and quit. These are [Sparkle's update settings](https://sparkle-project.org/documentation/customization/);
the pinned [2.10.0 host reads UserDefaults before Info.plist](https://github.com/sparkle-project/Sparkle/blob/2.10.0/Sparkle/SUHost.m).
The driver does not write persistent update preferences or edit the bundle. The suite compares the signing
details (including CDHash) before/after and verifies the final bundle seal.

## Coverage and boundaries

- Native lifecycle: an x86_64 app process finishes launching with a visible
  window; its own bundled Node publishes a healthy service; normal quit stops
  both processes; restart creates a new service process with the same identity.
- Real service API and stream: reject anonymous requests, validate/save settings,
  round-trip Chinese text, store/read a synthetic provider credential in the OS
  keychain, verify the model, stream a task, deduplicate submissions, preserve
  multi-turn context, rename a task, write/read a synthetic file in its task
  folder, cancel an active stream, recover from an upstream error, restore
  settings/provider/transcript after restart, and remove tasks and the credential.
- The only model endpoint is a deterministic Chat Completions server on a fresh
  loopback port. No OpenCode key, real account, private file or model spend is used.
  The provider has file tools only for the explicit file case, and memory is off.
- A window count does **not** establish WKWebView readiness, native bridge/relay
  correctness, usable UI controls, or floating-panel behavior. API requests do
  not exercise the UI path. These remain a separate UI-testing milestone.
- Chinese IME composition, global hotkeys, Screen Recording/Accessibility grant,
  denial/regrant flows, Finder installation, Gatekeeper, updates, widgets, live
  providers, multi-monitor, peripherals and hardware performance remain untested.
  This does not establish complete Intel macOS 15 compatibility or replace a
  physical Intel Mac test. The runner image can change its OS patch and WebKit.

`report.json` / `report.md` record PASS / FAIL / UNTESTED per case, actual guest
macOS version/build, runner image, x86_64 architecture, Node/app/build versions,
service build ID, workflow commit, DMG digest and signing requirement. GitHub does
not expose the underlying physical host's full configuration; the reported system
is the hosted VM. Unreached cases stay UNTESTED. Failures need triage against the
logs as app, runner/environment, or test-harness failures; a timeout is not proof
of an app defect. No case is silently skipped into success.

The `intel-macos15-smoke-evidence` artifact retains TAP output, the driver build
log, reports, current service logs and relevant crash/native logs for seven days.
A screenshot is attempted only with an **existing** screen-capture grant; absence
is recorded, without changing TCC or presenting a consent request. Tokens are
redacted; data directories and keychains are never uploaded. Cleanup addresses
only the app/service PIDs owned by this test and removes its temporary directory.

## Local validation without a Release app or CI run

Use the repository-pinned Node and pnpm and already-installed dependencies:

```sh
pnpm -r --filter @atd/agent-service... --filter '!@atd/file-index' build
node --test apps/macos/Tests/ReleaseSmoke/harness.test.mjs \
  apps/macos/Tests/ReleaseSmoke/core-contract.test.mjs
mkdir -p tmp/release-smoke-validation
xcrun swiftc -swift-version 6 -parse-as-library -target x86_64-apple-macos15.0 \
  apps/macos/Tests/ReleaseSmoke/AppDriver.swift \
  -o tmp/release-smoke-validation/app-driver-intel
actionlint .github/workflows/release.yml
```

`core-contract.test.mjs` validates the shared cases against a source-built service
in a temporary directory, with the existing **in-memory keyring test seam**. Its
restart is a service restart. Passing locally validates the harness/contracts,
not Release startup, Intel execution, the macOS 15 window system or OS keychain.
The Release suite does not import this development-only test. It refuses to run
outside a hosted GitHub Actions Intel macOS 15 VM, including ARM/Rosetta and
self-hosted machines. No local command above opens Atd or triggers a workflow.

For an authorized future validation, the existing release workflow's `artifacts`
mode exercises this gate without publishing. Choose the exact reviewed commit
and retain its DMG digest; do not substitute a freshly rebuilt app for a failing
artifact. Replay the named case in the report on that same package and OS image,
then compare its service/native/crash logs. Live-provider and UI/TCC testing need
their own approved credentials, permissions and acceptance criteria.

## Promoting PR release candidates

A same-repository PR targeting `main` produces a signed, dual-architecture release
candidate when `apps/macos/package.json` differs from its base version. The
`ci/release-candidate-reuse` branch also opts in for integration rehearsal at the
current version. Ordinary PRs with no version change and fork PRs keep their
existing checks. The shared `release-candidate.yml` preserves the existing native
build/DMG jobs, macOS 15 verification and Intel Release smoke checks. Candidate
production runs alongside quality checks; the complete CI run must pass. Xcode
timing summaries and passive DMG phase logs are retained for seven days, including
logs produced by failed runs.

When the version bump reaches `main`, `release.yml` automatically finds the PR
that introduced that exact commit, then its latest CI run for the PR head. It
never prefers an older green run over a newer unfinished or failed one. The
immutable candidate ID and archive digest, source receipt, actual tested merge
commit and full Git tree are validated before the usual draft/asset checks.
Different merge SHAs are accepted only for the identical complete repository
tree; the manifest retains the real build SHA. Formal promotion also requires
the PR's actual merged commit and the existing branch/version restrictions.

No matching PR/run/candidate, or an expired candidate, is reported explicitly
and uses the normal complete build and verification path. API errors, failed or
unfinished CI, wrong source/versions/tree, missing required checks or invalid
existing artifacts stop promotion. There is no silent fallback from a candidate
that fails verification. `mode=artifacts` always builds fresh. The optional
`candidate_run_id` still selects an explicit source; a PR source also takes
`candidate_pr_number`, while a manual source requires the exact commit.

To validate reuse before merging or publishing, refresh the PR branch from main,
wait for its complete CI, then dispatch `release.yml` on that branch with
`mode=rehearsal` and `candidate_pr_number`. The branch and its tested merge commit
must have the identical full tree; source-run discovery and all artifact checks
still run. After merging, dispatch on main with only `mode=rehearsal` to validate
automatic discovery without a PR hint. Both paths reuse the candidate, then
create, validate and delete a draft. Neither publishes or updates mirrors, and
neither needs an extra branch. An unmerged PR cannot be formally promoted.

For 0.10.8, review diagnostics and candidate reuse as separate CI PRs before the
final release PR. After the CI changes are approved and merged, update the
release branch from main, finish the feature changes and bilingual release post,
then bump all required versions in the final PR. Wait for the complete candidate
CI before merging that PR. Any intervening change to main requires refreshing
and revalidating the candidate's complete tree. Keep candidate generation scoped
to release preparation rather than every development push.

These changes do not enable the experimental Rust release cache, DMG job split,
phase timeout supervisor or Swift cache. Measure first candidate production and
subsequent promotion separately; moving compilation into PR CI does not make
the complete build-and-release workflow as short as promotion alone.
