# AI

A quiet desktop agent panel. It sits in the bottom-right corner of the screen, opens with a global shortcut, and runs coding and general-purpose agent tasks on your machine.

The app has two parts. An Electron desktop client provides the floating panel and a settings window. A local agent service built on the [pi](https://github.com/earendil-works/pi) SDK runs the tasks, stores data, and handles credentials. The service can also serve the same UI to a paired browser.

![AI task panel](docs/task-panel.png)

_This is an early renderer preview. On macOS, the native window material changes with the desktop behind it._

## Features

- **Task panel**: a 420 × 580 panel placed 16px from the right and bottom edges of the display work area. It works on secondary displays, negative coordinates, and small work areas. It can stay on top, and hiding it keeps the current draft.
- **Conversations**: streamed replies, task history, follow-up messages, stop and resume, and recovery after an interrupted run. A task keeps the model it started with, even if you change the default later.
- **Composer**: `@` mentions for files and `/` for commands and skills, shown as inline chips. It also accepts attachments, selected text, and clipboard context. Enter sends, Shift + Enter adds a new line, and confirming an IME candidate does not send the message.
- **Tool activity**: file diffs, terminal output, web tools, a todo list, and subagent transcripts appear inline in the conversation.
- **Permissions**: three approval tiers (Manual, Auto, Always allow) plus a shell allowlist. You set a default for new tasks, and each task can change its own tier from the composer.
- **Providers**: named connections, each with its own credentials and default model. The catalog comes from the pi registry, with entry points for local and custom connections.
- **Commands**: reusable instructions with Mustache variables, typed parameters, shortcuts, and tool settings. AI-suggested instructions are previewed first; applying one changes only the unsaved draft and can be undone.
- **Extensions**: skills, subagents (including Markdown agents from `~/.atd/agents`), and MCP servers, each of which can be turned on or off for the next run.
- **Memory**: long-term memory powered by [pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory), with search, editing, deletion, and a pause for learning.
- **Settings**: Permissions, Extensions, Providers, Commands, Memory, and Shortcuts. The settings navigation is a sidebar at 760px and wider, compact top navigation from 480px, and a drawer below that.
- **Languages**: English and Simplified Chinese. The first run follows the OS locale.
- **Web client**: open the same UI in a browser through a one-time pairing link.

Default shortcuts:

| Action             | macOS                 | Windows / Linux       |
| ------------------ | --------------------- | --------------------- |
| Show or hide panel | ⌘ ⇧ Space             | Ctrl + Shift + Space  |
| New conversation   | ⌘ N                   | Ctrl + N              |
| Open settings      | ⌘ ,                   | Ctrl + ,              |
| Send / new line    | Enter / Shift + Enter | Enter / Shift + Enter |

You can change all of them in Settings → Shortcuts. If the OS refuses the global shortcut, the panel is still available from the app menu and the Dock or taskbar.

## Requirements

- Node.js **24.19.0** (see `.node-version`). The service requires `^24.15.0 || >=26.0.0`.
- pnpm **12.3.4** (see `packageManager` in `package.json`).
- At runtime, unpackaged builds (`pnpm dev`, `pnpm --filter @ai/desktop start`) run the agent service with the system Node.js on `PATH`. Packaged apps ship their own Node.js and need nothing installed. The Electron binary is never used as Node.
- Commands the agent runs use your own tools. A packaged app asks your login shell (`$SHELL -il`) for its `PATH` once per launch, waiting at most 5 seconds, so tools from nvm, pyenv, cargo, Homebrew and your rc files resolve as they do in a terminal. The bundled Node.js comes last on that `PATH`, as a fallback when you have none. Only `PATH` is taken from the shell; unpackaged builds keep the `PATH` of the terminal that started them.

## Getting Started

```sh
corepack enable
```

```sh
pnpm install
```

```sh
pnpm dev
```

`pnpm dev` builds the workspace packages, watches the agent service, and starts Vite with Electron. The desktop app then starts its own agent service. The React UI hot-reloads, and Electron restarts when the main process or preload changes. Press **Ctrl + C** to stop everything.

To run a real model, open Settings → Providers, add a working connection, choose a default model, and make that connection the default provider.

### Web client

While `pnpm dev` is running, open <http://127.0.0.1:5173> in a browser. The dev server proxies `/v1` to the service the desktop app started and signs the page in automatically through a same-origin pairing endpoint.

To run the web UI without Electron:

```sh
pnpm dev:web
```

This needs a running service; set `AI_AGENT_DATA_DIR` or `AI_AGENT_URL` to choose which one. Add `?preview` to the URL to render the bare UI without a service. `pnpm dev` and `pnpm dev:web` use the same port (5173), so run only one of them at a time.

### Agent service CLI

The service runs on its own as well. After `pnpm build`, run it from `apps/agent-service`:

```sh
node dist/cli.js --help
```

| Command   | Purpose                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `serve`   | Start the service in the foreground (loopback only; `--port 0` picks one). |
| `status`  | Print the status of the running service.                                   |
| `web`     | Print a one-time browser pairing link (`--open` opens it).                 |
| `stop`    | Ask the running service to shut down.                                      |
| `migrate` | Import a copy of older desktop data, with dry-run and rollback.            |

`pnpm --filter @ai/desktop build:web` builds the web client that `serve --web-root apps/desktop/dist-web` serves at `/`.

## Workspace

```text
apps/
  desktop/               Electron app: main process, preload, and React renderer
    electron/            Windows, IPC, settings, shortcuts, service launcher
    src/                 React UI, features, i18n, web client entry
    tests/               Vitest setup and the Playwright Electron smoke suite
  agent-service/         Local agent service (Fastify HTTP + WebSocket, pi SDK)
    src/                 Tasks, providers, credentials, MCP, skills, subagents, memory
    product-skills/      Built-in skills shipped with the service
packages/
  agent-contracts/       Shared TypeBox schemas for the service protocol
  agent-client/          HTTP and WebSocket client used by desktop and web
  ui/                    Shared shadcn components, theme tokens, brand assets
  typescript-config/     Shared TypeScript configuration
patches/                 pnpm patches for pinned pi extensions
docs/                    Design sources, plans, and screenshots
```

## Tech Stack

| Area            | Choice                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Desktop         | Electron 44, Vite 8 (Rolldown, Oxc), `vite-plugin-electron`                                                          |
| UI              | React 19, Tailwind CSS 4, shadcn (Radix / Rhea preset `b27GcrRo`), Lucide, Inter                                     |
| Editor & render | CodeMirror 6, Streamdown, `@pierre/diffs`, `@pierre/trees`                                                           |
| Agent runtime   | `@earendil-works/pi-coding-agent` and `pi-ai` 0.87.1, pi extensions for memory, MCP, subagents, web tools, and todos |
| Service         | Fastify 5, `@fastify/websocket`, TypeBox, `@napi-rs/keyring`                                                         |
| Tooling         | pnpm workspaces, Turborepo, TypeScript 7, Oxlint, Oxfmt, Vitest, Playwright                                          |

All direct dependencies use exact versions, and installs use `pnpm-lock.yaml`. See each `package.json` for exact versions.

## Checks and Packaging

```sh
pnpm check
```

Runs the format check, Oxlint, TypeScript, Vitest, and the production build. You can also run each step on its own with `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

```sh
pnpm test:electron
```

Builds the app and runs the Playwright smoke suite against a real Electron window in a temporary profile.

```sh
pnpm package
```

Builds an unsigned app directory for the current platform. On macOS the output is `apps/desktop/release/mac-arm64/AI.app` (`mac` on Intel). The agent service, its production dependencies, and the web client are copied into the app resources, together with the official Node.js release pinned by `.node-version` for the build machine's platform and architecture. The first pack downloads that release into `tmp/node-dist/` and checks it against the release's `SHASUMS256.txt`. Each pack also writes a new build ID; a packaged app only reuses a running service with the same build ID and replaces any other. `pnpm --filter @ai/desktop start` runs the production build without packaging.

Installer targets (dmg, nsis, AppImage) are configured in `apps/desktop/electron-builder.yml` but are not part of the packaging script. Signing and notarization are not set up.

GitHub Actions runs `pnpm check` on Linux, and the Electron smoke suite and app packaging on macOS. Windows and Linux builds have not been verified locally.

## Data and Security

- **Process isolation**: the renderer runs with `contextIsolation` and `sandbox`, and without `nodeIntegration`. External navigation, pop-ups, and permission requests are restricted. The preload exposes a narrow, typed API, and the main process validates the sender and the payload of every IPC call.
- **Local service**: the agent service listens only on loopback and requires a bearer token stored in its data directory. Browsers sign in through one-time pairing codes.
- **Credentials**: provider and MCP secrets are stored in the OS keychain (macOS Keychain, Windows Credential Manager, or Secret Service on Linux). They never reach the renderer or task snapshots. If no persistent keyring is available, the service says so and runs only with temporary credentials from `AI_AGENT_TEMP_*` environment variables, which it never stores.
- **Service lifecycle**: the desktop app starts the service as its child and stops it on quit. When tasks are running, quitting first asks whether to stop them; queued tasks stay queued and start the next time the app opens. OS shutdown, logout, and termination signals quit without asking. If the service exits unexpectedly, the app restarts it with an increasing delay. After 3 unexpected exits within 5 minutes it stops trying, and **Restart Agent Service** in the menu starts it again.
- **Logs**: the service's output goes to `logs/service.log` in its data directory, with the previous four launches kept as `service.1.log` to `service.4.log` (**Show Service Logs** in the menu opens the folder). The desktop app's main process logs to `~/Library/Logs/AI/main.log` on macOS.
- **Data location**: tasks, settings, and memory live in the service data directory:
  - macOS: `~/Library/Application Support/AgentService`
  - Windows: `%LOCALAPPDATA%\AgentService`
  - Linux: `$XDG_DATA_HOME/agent-service` (default `~/.local/share/agent-service`)

  `AI_AGENT_DATA_DIR` overrides this location. `AI_TEST_USER_DATA` gives the desktop app an isolated profile with its own service data, which is useful for debugging without touching your real data.

- **Window material**: on macOS the panel uses native HUD vibrancy. The system draws the corners, edge highlight, and shadow; the renderer keeps its root transparent and paints a single token-based content surface. Browser previews and other platforms use a translucent CSS surface instead.
- **CSP**: production builds use a strict Content Security Policy. Only the local dev server allows the inline script that React Fast Refresh needs.

## Design

Screens and project components live in the [project Figma file](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai). Shared controls and Lucide icons come from the approved [shadcn UI kit](https://www.figma.com/design/tEV8H6Msibbc64Dds5eehO/shadcn-ui-kit-community-edition--Community-). Brand SVGs are kept in `packages/ui/src/assets/brands/`.

To add a shadcn component:

```sh
pnpm dlx shadcn@4.21.0 add dialog -c apps/desktop --yes
```

Components are generated into `packages/ui/src/components`. After running the CLI, check the import paths and any dependency changes.

For the design-to-code mapping, see [docs/design-source.md](docs/design-source.md). Implementation plans are in [docs/plans/](docs/plans/). Contributor and agent guidelines are in [AGENTS.md](AGENTS.md).
