---
name: runtime-debugging
description: Use when a task needs rendered, native, or service behavior from the macOS app — launch an isolated instance, inspect it with Safari Web Inspector, logs, or HTTP, read facts, clean up.
---

# Runtime debugging

Procedure for the rules in `AGENTS.md` → [Commands And Local Runtime](../../../AGENTS.md#commands-and-local-runtime).
Start an isolated instance, attach tooling, read facts, stop it.

## When to use

- A change's acceptance criteria depend on what actually renders or what the native window does.
- A bug report describes behavior you cannot settle by reading source: computed styles, focus order, bridge or relay round-trips, window geometry, console errors, network calls.
- You need evidence for [Visual Acceptance](../../../AGENTS.md#visual-acceptance), or a repeatable repro for a flaky interaction.

Not for: pure source questions or aesthetic judgement — Web Inspector answers what is computed and rendered, not whether it looks good.

## Launch paths

| Surface             | Launch                                                                                                                           | Attach                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Service             | `AI_AGENT_DATA_DIR=$(mktemp -d) pnpm dev:headless`; ready once that directory has `endpoint.json`                                | HTTP to the `url` in `endpoint.json` with the bearer token from `auth/token`          |
| Native app, Debug   | `AI_AGENT_DATA_DIR=$(mktemp -d) pnpm dev` (builds the Debug app and opens it with that dir once the service and Vite answer)     | Safari Web Inspector (Develop menu) for the page; unified logs or Xcode for the shell |
| Native app, Release | `pnpm --filter @ai/macos build:release`, then `open --env AI_AGENT_DATA_DIR=<temp> <Release AI.app>` with the installed app quit | The shell's unified logs and the bundled service's `~/Library/Logs/AI/service.log`    |

- The native Debug app (`pnpm --filter @ai/macos build`) only connects: it reads `endpoint.json` and `auth/token` from `AI_AGENT_DATA_DIR` (default: the dev data dir `~/Library/Application Support/AgentService Dev`) and never starts a service. `pnpm dev` builds it and opens it with its own `AI_AGENT_DATA_DIR` and `AI_RENDERER_DEV_ORIGIN` once both answer, skips opening when a Debug app (same bundle id) is already running — check `lsappinfo find bundleid=com.junerdd.ai.dev` first, since that one would be the user's and a second instance exits at launch — and quits the app it opened when interrupted. Use `pnpm dev:headless` when no app is needed.
- Vite needs its port free: 5173, or the port in `AI_RENDERER_PORT`. `scripts/dev-guard.mjs` refuses to start `pnpm dev` or `pnpm dev:headless` on a busy port. To run beside another dev server, set `AI_RENDERER_PORT=<free port>` and `AI_RENDERER_DEV_ORIGIN=http://127.0.0.1:<same port>` together, so the Debug app loads that server.
- The page runs only inside the shell. A plain browser on the Vite dev server gets no `window.desktop` bridge and shows only the "runs only inside the AI app for macOS" notice, so every rendered check goes through the Debug app.
- The native page is WebKit, not Chromium: CDP clients such as chrome-devtools-mcp cannot attach. Debug builds set WKWebView `isInspectable`, so the expected path is Safari → Settings → Advanced → "Show features for web developers", then Develop → this Mac → the AI page. The panel and the settings window are separate pages; the settings URL carries `#settings`. Release builds are not inspectable.
- The Swift shell logs through `Logger` under the subsystem `com.junerdd.ai` (categories such as `shell`, `relay`, `service`): `log stream --predicate 'subsystem == "com.junerdd.ai"'`. In Debug, the service's output stays in the `pnpm dev` terminal; a Release app writes it to `~/Library/Logs/AI/service.log`, keeping the previous four launches.
- Use `screencapture` for the OS-composited window; page screenshots do not show the native glass.

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

1. **The user's Debug app wins.** One Debug app runs per bundle id. If the user's is open, `pnpm dev` does not open another, and the running one keeps talking to the user's service. Ask before touching it; do not quit it.
2. **Fresh data directories are localized.** A new data directory has no stored `language`, so the page resolves it from the OS locale and renders zh-CN on a Chinese macOS. Tests that assert English copy fail on such a machine for that reason alone — not because of your change.
3. **Don't attach to the user's instance.** A debug session reads and changes everything the app can see, including real tasks and provider credentials. Never point it at the user's data directory, and attach to a window the user is using only when the user asks for that inspection.
4. **Keep the security posture.** Do not disable the CSP header, the relay allow-list, the origin and `x-ai-relay` checks, or the native navigation lock to make debugging easier — renderer isolation is part of the behavior under test (the Swift relay tests in `apps/macos/Tests`). A temporary CSP change for a debug collector follows the AGENTS.md rule and is reverted at cleanup.
5. **Page-only truth is partial.** Web Inspector and page screenshots do not verify native window glass, composition, or corner clipping — say so instead of claiming the native surface is verified.

## Cleanup and evidence

- Stop only the instances you started (for `pnpm dev`, interrupt its Turbo process so the service releases its lock and removes `endpoint.json`, and the app it opened quits); leave the Vite port free, and delete throwaway data directories.
- Report the exact command, the facts read, and the unverified remainder. Keep throwaway scripts out of the repository tree; durable automated checks belong in the existing Vitest, service, or Swift tests.
