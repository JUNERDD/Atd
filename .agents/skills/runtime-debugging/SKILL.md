---
name: runtime-debugging
description: Use when a task needs rendered, native, or service behavior from the macOS app — reuse the user's dev environment, inspect it with Safari Web Inspector, logs, or HTTP, and read facts. Isolate only on explicit request.
---

# Runtime debugging

Procedure for the rules in `AGENTS.md` → [Commands And Local Runtime](../../../AGENTS.md#commands-and-local-runtime).
Reuse the user's dev environment, start it if needed, attach tooling, and read facts. Use isolation only when explicitly requested. `AGENTS.md` owns the environment and cleanup policy.

## When to use

- A change's acceptance criteria depend on what actually renders or what the native window does.
- A bug report describes behavior you cannot settle by reading source: computed styles, focus order, bridge or relay round-trips, window geometry, console errors, network calls.
- You need evidence for [Visual Acceptance](../../../AGENTS.md#visual-acceptance), or a repeatable repro for a flaky interaction.

Not for: pure source questions or aesthetic judgement — Web Inspector answers what is computed and rendered, not whether it looks good.

## Launch paths

| Surface             | Launch                                                                                                                                                   | Attach                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Service             | Reuse the dev service, or start `pnpm dev:headless`; ready once its data directory has `endpoint.json`                                                   | HTTP to the `url` in `endpoint.json` with the bearer token from `auth/token` |
| Native app, Debug   | Reuse the Debug app, or start `pnpm dev`                                                                                                                 | Safari Web Inspector for the page; unified logs or Xcode for the shell       |
| Native app, Release | Build with `pnpm --filter @atd/macos build:release`, then launch with the dev data directory, the installed app quit and no service using that directory | The shell and bundled service logs; no Web Inspector                         |

- The native Debug app (`pnpm --filter @atd/macos build`) only connects: it reads `endpoint.json` and `auth/token` from `AI_AGENT_DATA_DIR` (default: the dev data dir `~/Library/Application Support/AgentService Dev`) and never starts a service. `pnpm dev` reuses a verified unchanged build or builds it, then opens the registered `~/Applications/Atd Dev.app` through LaunchServices with its own `AI_AGENT_DATA_DIR` and `AI_RENDERER_DEV_ORIGIN` once Vite and the authenticated service identity both answer. LaunchServices keeps macOS privacy checks attributed to Atd instead of the launching terminal; do not execute `Contents/MacOS/Atd` directly. The supervisor owns only the application instance returned by that launch. It watches native sources/configuration and bridge/widget contracts, serializes rebuilds, and replaces that instance only after a successful build; failed builds keep it open. It skips building and opening when a Debug app (same bundle id) is already running — check `lsappinfo find bundleid=com.junerdd.ai.dev` first, and reuse the running app for the requested inspection, since a second instance exits at launch — and quits the app it opened when interrupted. Use `pnpm dev:headless` when no app is needed.
- Turbo watch rebuilds shared packages (including the Rust file index) and the service before restarting `dist/cli.js`; service resources in `view-kit/` and `product-skills/` also trigger a restart. Restarting interrupts active runs. A failed service/dependency build keeps the service stopped until a successful edit; the Vite server and native supervisor remain alive. Renderer/shared UI edits use Vite HMR, and unchanged generated Swift does not restart the app. Native supervisor script edits need a fresh `pnpm dev`. The local `apps/macos/DerivedData/dev-app-receipt.json` binds source/resource/generated-code content to the checkout, architecture, toolchain and signing context and checks both built and installed bundles. Bridge validation has an independent success record covering contracts, generators, dependencies, generated output and tool identities; unchanged inputs/outputs skip both schema and Swift checks. Generated-output edits also trigger validation; changes during validation must settle before certification. A full native-build hit skips Xcode and installation; a replaced installed copy is refreshed from a valid build. Remove the receipt to force a rebuild. Failed builds and edits arriving during a build do not certify a cache hit.
- Repeated development starts reuse successful Turbo watch outputs, including the file-index addon when the startup compiler context is known and unchanged; production native builds remain uncached. Custom compiler/Cargo settings disable native caching. The root task graph, launcher scripts, Cargo configuration and toolchain are startup snapshots: restart `pnpm dev` after changing them. The service development entry uses Node’s built-in compile cache (`NODE_DISABLE_COMPILE_CACHE=1` disables it). To diagnose slow starts, compare the development ready log’s `startupMs` with `initializeMs`; their difference includes module loading before initialization. Cache-hit task logs do not replay old compilation output. Session preparation and subagent delegation modules load on the first executing task; startup measurements must be paired with a first-task check, including Stop during that load.
- Vite needs its port free: 5173, or the port in `AI_RENDERER_PORT`. `scripts/dev-guard.mjs` refuses to start `pnpm dev` or `pnpm dev:headless` on a busy port. Only when isolation is explicitly requested, run beside another dev server by setting `AI_RENDERER_PORT=<free port>` and `AI_RENDERER_DEV_ORIGIN=http://127.0.0.1:<same port>` together, so the Debug app loads that server.
- The page runs only inside the shell. A plain browser on the Vite dev server gets no `window.desktop` bridge and shows only the "runs only inside the Atd app for macOS" notice, so every rendered check goes through the Debug app.
- The native page is WebKit, not Chromium: CDP clients such as chrome-devtools-mcp cannot attach. Debug builds set WKWebView `isInspectable`, so the expected path is Safari → Settings → Advanced → "Show features for web developers", then Develop → this Mac → the Atd page. The panel and the settings window are separate pages; the settings URL carries `#settings`. Release builds are not inspectable.
- The Swift shell logs through `Logger` under the subsystem `com.junerdd.ai` (categories such as `shell`, `relay`, `service`): `log stream --predicate 'subsystem == "com.junerdd.ai"'`. In Debug, the service's output stays in the `pnpm dev` terminal; a Release app writes it to `~/Library/Logs/AI/service.log`, keeping the previous four launches.
- Use `screencapture` for the OS-composited window; page screenshots do not show the native glass.

### Prepare an explicitly requested isolated profile

Ordinary checks reuse the user's existing dev profile without resetting onboarding or seeding data. Only when isolation is explicitly requested, start `pnpm dev:headless` with a temporary `AI_AGENT_DATA_DIR` and a verified free renderer port. For checks unrelated to onboarding, use that service's authenticated `PATCH /v1/settings` route to set `onboardingCompleted: true` and `onboardingProgress: null`. Verify both fields with `GET /v1/settings` before launching the Debug app with the same `AI_AGENT_DATA_DIR` and `AI_RENDERER_DEV_ORIGIN`. The one-step `pnpm dev` launch opens the app before this preparation can finish.

Each fresh data directory otherwise starts the onboarding intro again. Within an explicitly isolated check sequence, reuse the prepared task-owned profile, or repeat this preparation for each new profile; do not seed or reset the user's profile to prepare these isolated checks. Keep the default onboarding state when first-run or onboarding behavior is what the task tests.

## A reporter needs a separate diagnostic build

Follow the permanent `debug` branch workflow in
[AGENTS.md](../../../AGENTS.md#debug-branch-and-reusable-diagnostic-builds). It owns branch
isolation, one-way production synchronization, collector reuse, packaging and delivery rules.
Never merge this branch into `main`. See [Support diagnostic builds](../../../apps/macos/DIAGNOSTICS.md)
for profile coverage, report fields and implementation details. Local environment and launch
authorization still follow AGENTS.md and current instructions.

## Read facts, not dumps

- In the Web Inspector console, project the answer into a small value instead of dumping markup:

  ```js
  ({
    window: document.documentElement.dataset.window,
    composer: !!document.querySelector('.composer'),
  });
  ```

- Prefer the Elements and Accessibility panels over `outerHTML`. The app renders hundreds of nodes; a raw dump buries the answer.
- For "why is this value not applying", read `getComputedStyle` plus the ancestor chain before editing any call site: a value with no class of its own is inherited, and the fix belongs to the ancestor rule or the shared owner.
- For service state, query the `/v1` route that owns it and read the fields you asserted, rather than reading files in the data directory while the service runs.

## Pitfalls

1. **Reuse the user's Debug app.** One Debug app runs per bundle id. If it is open, `pnpm dev` does not open another. Attach for the requested work without another confirmation; do not quit it as task cleanup.
2. **Fresh data directories are localized.** A new data directory has no stored `language`, so the page resolves it from the OS locale and renders zh-CN on a Chinese macOS. Tests that assert English copy fail on such a machine for that reason alone — not because of your change.
3. **Keep dev access scoped.** Use the user's dev data and configuration by default. This does not authorize unrelated conversation history, credential disclosure, data resets, or inspection of the installed app's production data.
4. **Keep the security posture.** Do not disable the CSP header, the relay allow-list, the origin and `x-ai-relay` checks, or the native navigation lock to make debugging easier — renderer isolation is part of the behavior under test (the Swift relay tests in `apps/macos/Tests`). A temporary CSP change for a debug collector follows the AGENTS.md rule and is reverted at cleanup.
5. **Page-only truth is partial.** Web Inspector and page screenshots do not verify native window glass, composition, or corner clipping — say so instead of claiming the native surface is verified.

## Cleanup and evidence

- Preserve the user's dev environment after ordinary verification. Clean up explicitly requested isolated instances you started: interrupt their Turbo process so the service releases its lock and removes `endpoint.json`, and the app it opened quits; release their ports and delete their temporary data directories.
- Report the exact command, the facts read, and the unverified remainder. Keep throwaway scripts out of the repository tree; durable automated checks belong in the existing Vitest, service, or Swift tests.
