# Support diagnostic builds

This guide and implementation live only on the permanent `debug` branch. Follow
[AGENTS.md](../../AGENTS.md#debug-branch-and-reusable-diagnostic-builds) for the reusable workflow
and branch policy. Never merge this branch into `main`; production fixes use a fresh main-based branch.

Diagnostics ship as a separate, manually distributed build. Ordinary builds have no recorder,
extra permission prompts or Diagnostics section. There is no runtime preference that enables them.
Support builds keep the production bundle identity and data directory, disable automatic updates,
and never upload a report. Use the existing release signing identity so privacy grants survive.

## Choose the evidence before building

| Profile   | Evidence                                                                                                                                                                                                                                                                                           | Additional access                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `none`    | No support recording; default for ordinary builds                                                                                                                                                                                                                                                  | None                                                                                                          |
| `runtime` | Build/system facts; shell and page readiness; validated native call names, completion and duration; rejected bridge messages; service endpoint transitions; relayed HTTP outcomes and sizes; stream connection lifecycle and counts; page focus, visibility, viewport, error signals and heartbeat | None                                                                                                          |
| `focus`   | Everything in `runtime`, plus window ordering/geometry, AX focused application, mouse delivery at the session/native/page layers, activation requests and delayed snapshots                                                                                                                        | Requests missing Accessibility before reproduction; Input Monitoring only if the mouse tap still cannot start |

The runtime profile does **not** record service internals, model/provider requests, plugin internals,
arbitrary console output, exception messages or stacks. It observes the shell-to-service boundary.
A report cannot explain a path that has not been instrumented. Add the needed collector before
asking a reporter to reproduce; do not label absent coverage as a negative result.

## Build and deliver

After the normal Release bundle preparation, the local build command is:

```sh
node apps/macos/scripts/build.mjs --configuration Release --diagnostic-profile focus
```

The signed CI path uses the existing release workflow in **artifacts** mode:

```sh
gh workflow run release.yml --ref debug \
  -f mode=artifacts \
  -f marketing_version=0.0.0-diagnostic.1 \
  -f build_version=0.0.0diagnostic.1 \
  -f diagnostic_profile=focus
```

Replace the example versions with the intended app version and a unique support suffix. Build from
a committed revision on `debug`. This branch's workflow rejects all publishing/rehearsal modes,
other branches, automatic runs and the `none` profile. It checks the embedded profile and revision, and creates downloadable artifacts without a release,
update-feed publication or stable/preview download-channel change. `runtime` uses the same path. The workflow
builds both architectures and publishes their verified downloads to the dedicated debug channel
([publisher](../../ops/debug-downloads/README.md)). Send `/debug` or `/zh/debug` with the intended
version; the reporter selects their architecture.

Before delivery, inspect the actual DMG: checksum, signature, architecture, app/build version,
`AtdDiagnosticProfile` and `AtdDiagnosticRevision`. Run the packaged-app verifier. With runtime
launch authorization, open this exact package, verify its selected collectors and export a real
ZIP through Settings. A source build alone does not establish that the shipped recorder works.

Give the reporter one sequence: quit the ordinary app, open the support build, complete any
requested permissions, reproduce, then immediately use **Settings → General → Diagnostics →
Export diagnostic log**. Preserve the settings and environment involved in the report. Explain
what the selected profile collects. Return to an ordinary build after collecting the report.

## Report contract and analysis

`SupportDiagnostics` owns startup, profile selection, periodic checkpointing and export.
`DiagnosticRecorder` stores the bounded evidence. `SupportDiagnosticArchive` owns disk work and
ZIP creation. `FocusDiagnostics` is a collector, not the owner of the report lifecycle.

- `manifest.json`: schema version, exact build/profile, collectors, event/module counts,
  retained/dropped records, encoding errors, checkpoint status and focus permission coverage.
- `current.ndjson`: one ordered launch session with module, event, wall time, monotonic uptime,
  sequence, optional correlation, reviewed details and optional collector snapshot.
- `previous.ndjson`: the previous launch of the same profile, when available. Treat its session
  independently; an evicted `session.start` means its environment header may be unavailable.
- `README.txt`: common interpretation rules plus notes from the selected specialty collector.

Check the manifest before drawing conclusions. Follow correlated `bridge.begin/end`,
`relay.begin/response/end` and `stream.begin/open/sample/close` records. Requests are classified
by an allow-listed route family, never their URL, parameters, query, headers or body. Individual
bridge and relay spans have local correlation IDs; they are **not** a distributed trace through
the Node service. Page error signals deliberately omit messages and stacks. For focus failures,
follow the collector notes and compare delayed activation snapshots, not just the immediate call.

`runtime.sample` and page heartbeat delays expose delayed event loops, not stack traces of hangs.
Background page timers can be throttled; interpret them with page visibility. Inspect
`snapshotMs` for observer overhead. A missing end can mean eviction, interruption or a crash.
Zero events can mean missing instrumentation, an unloaded page or unavailable permissions.

Each profile keeps two launch traces under `~/Library/Logs/AtdDiagnostics/<profile>`, at most
8 MiB / 3000 records each. A checkpoint runs every five seconds; abrupt termination can lose the
last interval. Counts include evicted records. Export freezes current evidence before presenting
the save dialog. Different profiles never silently attach each other's traces.

## Extend for another issue

1. State the competing explanations and identify the boundaries that distinguish them.
2. Add observations to the owning feature. Use `SupportDiagnostics.record` in the shell and
   `SupportDiagnosticEvents.record` at relay boundaries. Add page events to the typed bridge
   contract; do not add an unrestricted text/log forwarding endpoint.
3. Record reviewed enums, numeric status/duration/counts and generated correlation IDs. Never
   pass `localizedDescription`, arbitrary payloads, chat text, paths, URLs, tokens or screenshots.
   Permissions are requested by the collector's preparation step, before reproduction.
4. Expensive or permission-requiring collectors get an explicit profile. Register the profile in
   the build CLI, workflow and `SupportDiagnostics`; expose its coverage and accurate UI copy.
   Keep probes inert in `none`. Preserve event delivery, activation and network behavior.
5. Reuse the existing recorder, export UI, signing and artifact workflow. Regenerate bridge types
   after contract edits. Run relevant existing checks and inspect an exported report for coverage,
   loss, privacy and observer overhead. Keep the reporter's instructions to one reproduction.

These hooks assemble problem-specific evidence; they are not a replacement for the app's OSLog
or service logging. Community research found [Pulse](https://github.com/kean/Pulse) useful for
local Apple log storage/network inspection, [Pino](https://github.com/pinojs/pino) useful for Node
structured logs, and [Sentry](https://docs.sentry.io/platforms/apple/guides/macos/features/) useful
for crash monitoring. None supplies Atd's window/bridge evidence or this cross-runtime report
contract automatically. This change retains the verified small report assembler, adds boundary
observations, and does not introduce a second general logging SDK or migrate existing logs.
Evaluate those libraries when a collector actually needs their storage, network or crash features.
