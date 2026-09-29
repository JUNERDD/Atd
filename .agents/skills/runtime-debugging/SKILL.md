---
name: runtime-debugging
description: Use when a task needs rendered, native, or IPC behavior from the desktop app — launch an isolated instance, attach CDP or Playwright, read facts, clean up.
---

# Runtime debugging

Procedure for the rules in `AGENTS.md` → [Commands And Local Runtime](../../../AGENTS.md#commands-and-local-runtime).
Start an isolated instance, attach tooling, read facts, stop it.

## When to use

- A change's acceptance criteria depend on what actually renders or what the native window does.
- A bug report describes behavior you cannot settle by reading source: computed styles, focus order, IPC round-trips, window geometry, console errors, network calls.
- You need evidence for [Visual Acceptance](../../../AGENTS.md#visual-acceptance), or a repeatable repro for a flaky interaction.

Not for: performance or heap work (use the Node inspector), pure source questions, or aesthetic judgement — CDP answers what is computed and rendered, not whether it looks good.

## Launch paths

| Surface            | Launch                                                                                                                                       | Attach                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Renderer only      | `pnpm dev:renderer` → `http://127.0.0.1:5173`                                                                                                | browser automation on that origin                        |
| Native app (Debug) | `AI_AGENT_DATA_DIR=$(mktemp -d) pnpm dev`, then `open --env AI_AGENT_DATA_DIR=<same dir> apps/macos/DerivedData/Build/Products/Debug/AI.app` | Safari Web Inspector (Develop menu)                      |
| Electron app       | `pnpm build`, then `AI_TEST_USER_DATA=$(mktemp -d) pnpm --filter @ai/desktop exec electron . --remote-debugging-port=9333`                   | CDP on `http://127.0.0.1:9333`                           |
| Smoke suite        | `pnpm test:electron`                                                                                                                         | Playwright, temporary profile, `.artifacts/` screenshots |

- The native Debug app (`pnpm --filter @ai/macos build`) only connects: it reads `endpoint.json` and `auth/token` from `AI_AGENT_DATA_DIR` (default: the dev data dir `~/Library/Application Support/AgentService Dev`) and never starts a service. Start `pnpm dev` with the same temporary `AI_AGENT_DATA_DIR` first and wait for `endpoint.json` to appear there; Vite also needs `127.0.0.1:5173` free.
- The native page is WebKit, not Chromium: CDP clients (chrome-devtools-mcp, `scripts/inspect.mjs`) cannot attach. Debug builds set WKWebView `isInspectable`, so the expected path is Safari → Settings → Advanced → "Show features for web developers", then Develop → this Mac → the AI page. Use `screencapture` for the OS-composited window.
- `pnpm dev` and `pnpm dev:electron` refuse to run together (the repository's `scripts/dev-guard.mjs`), and `dev:electron` refuses to start without `AI_TEST_USER_DATA`.
- `pnpm dev:electron` (HMR in Electron) does **not** open a debug port: `apps/desktop/vite.config.ts` starts Electron with `['.']` only. Use `dev:renderer` for renderer iteration, or add a port through `vite.config.ts` in the task that needs both.
- The Electron row needs `pnpm build` first: `electron .` loads `dist-electron/main.js` and `dist/index.html`.
- `AI_TEST_USER_DATA` redirects `userData` (`apps/desktop/electron/main.ts`), which keeps real task data out of the debug instance and lets a second instance start at all. Verified: a launch that reuses another instance's profile exits within a second (`requestSingleInstanceLock`) and the running instance stays in charge.
- Verify the port before launching: `lsof -nP -iTCP:9333 -sTCP:LISTEN`. Chromium keeps running without a debug port when the bind fails and only logs `Cannot start http server for devtools`; treat that as a failed launch, not a fallback. Port 9222 in particular is often already bound by another app.
- With `dev:renderer` there is no `window.desktop` bridge (`src/App.tsx` renders the desktop-only hint), so IPC, window, and native-surface behavior is out of scope there.

## Attach over CDP (Electron)

`chrome-devtools-mcp` talks CDP to whatever exposes a debug port; of this project's surfaces, only Electron does. Point it at the instance instead of letting it launch its own Chrome:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--browserUrl",
        "http://127.0.0.1:9333",
        "--no-usage-statistics"
      ]
    }
  }
}
```

Hermes equivalent: `hermes mcp add chrome-devtools --command npx --args -y chrome-devtools-mcp@latest --browserUrl http://127.0.0.1:9333 --no-usage-statistics`, then restart or open a new session. The server only spawns a browser when a tool needs one and no `--browserUrl` is set.

Facts about the connection (all observed):

- Every page-scoped tool takes `pageId`; `list_pages` is the only one that does not. The panel and the settings window are separate pages — the settings URL carries `#settings` — and `list_pages` marks whichever is selected.
- Useful tools: `list_pages`, `take_snapshot` (accessibility tree — the cheapest way to see the real UI), `evaluate_script`, `click` / `fill` (by `uid` from the snapshot), `list_console_messages`, `list_network_requests`, `take_screenshot`, `performance_start_trace` / `performance_stop_trace`.
- The renderer is a Chromium page; the main process is not. IPC handlers, window geometry, and `electron/main.ts` logic need the Node inspector or logs.
- `npx chrome-devtools-mcp` **CLI** shares one daemon socket per machine, so `chrome-devtools <tool>` may talk to a browser some other session started. Prefer the stdio server above, or run `scripts/inspect.mjs` for a one-off check.

### One-off check without an MCP client

```sh
node .agents/skills/runtime-debugging/scripts/inspect.mjs --port 9333 --snapshot --console
```

Prints the page list, optionally the accessibility snapshot and console messages, and exits non-zero when no page is reachable.

## Read facts, not dumps

- Project the answer into a small JSON value inside one `evaluate_script` call:

  ```js
  () => ({
    runtime: document.documentElement.dataset.runtime,
    composer: !!document.querySelector('.composer'),
  });
  ```

- Prefer `take_snapshot` over `outerHTML`. The app renders hundreds of nodes; a raw dump buries the answer.
- For "why is this value not applying", read `getComputedStyle` plus the ancestor chain before editing any call site: a value with no class of its own is inherited, and the fix belongs to the ancestor rule or the shared owner.
- Keep interaction short: click through `uid`s from a snapshot, then re-read the specific fact you asserted rather than re-snapshotting everything.

## Pitfalls

1. **Silent missing debug port.** A bind conflict logs one line and continues. Always confirm `curl -s http://127.0.0.1:<port>/json/version` returns JSON before blaming tooling.
2. **Second launch does nothing.** Reusing a profile hits the single-instance lock; the new process exits and the old one keeps the port. One throwaway profile per instance (`AI_TEST_USER_DATA=$(mktemp -d)`).
3. **Fresh profiles are localized.** `language` resolves from the OS locale on first run, so a new debug profile renders zh-CN on a Chinese macOS. `pnpm test:electron` asserts English copy, so it fails on such a machine for that reason alone — not because of your change.
4. **Don't attach to the user's instance.** A debug session reads and changes everything the app can see, including real tasks and provider credentials. Never point it at the user's data directory, and attach to a window the user is using only when the user asks for that inspection.
5. **Keep the security posture.** Do not disable `sandbox`, `contextIsolation`, CSP, the relay allow-list, or the native navigation lock to make debugging easier — renderer isolation is part of the behavior under test (`tests/electron.spec.ts`, the Swift relay tests).
6. **Renderer-only truth is partial.** `dev:renderer`, browser screenshots, and Web Inspector do not verify native window glass, composition, or corner clipping — say so instead of claiming the native surface is verified.

## Cleanup and evidence

- Stop only the instances you started (for `pnpm dev`, interrupt its Turbo process so the service releases its lock and removes `endpoint.json`); leave `http://127.0.0.1:<port>` free, and delete throwaway profiles and data directories.
- Report the exact command, the facts read, and the unverified remainder. Keep throwaway scripts out of the repository tree; durable automated checks belong in `pnpm test:electron`.
