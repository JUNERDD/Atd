# AI

A quiet desktop agent panel. It sits in the bottom-right corner of the screen, opens with a global shortcut, and runs coding and general-purpose agent tasks on your machine.

The app has two parts. An Electron desktop client provides the floating panel and a settings window. A local agent service built on the [pi](https://github.com/earendil-works/pi) SDK runs the tasks, stores data, and handles credentials.

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

### Renderer preview

To check layout, styling, and copy without Electron:

```sh
pnpm dev:web
```

Then open <http://127.0.0.1:5173/?preview> in a browser. The page is the bare React UI: it does not connect to an agent service, and there is no browser client for real data. `pnpm dev` and `pnpm dev:web` use the same port (5173), so run only one of them at a time.

### Agent service CLI

The service runs on its own as well. After `pnpm build`, run it from `apps/agent-service`:

```sh
node dist/cli.js --help
```

| Command   | Purpose                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `serve`   | Start the service in the foreground (loopback only; `--port 0` picks one). |
| `status`  | Print the status of the running service.                                   |
| `stop`    | Ask the running service to shut down.                                      |
| `migrate` | Import a copy of older desktop data, with dry-run and rollback.            |

The service serves only the authenticated `/v1` API; it hosts no web page.

## Workspace

```text
apps/
  desktop/               Electron app: main process, preload, and React renderer
    electron/            Windows, IPC, settings, shortcuts, service launcher
    src/                 React UI, features, i18n
    tests/               Vitest setup and the Playwright Electron smoke suite
  agent-service/         Local agent service (Fastify HTTP + WebSocket, pi SDK)
    src/                 Tasks, providers, credentials, MCP, skills, subagents, memory
    product-skills/      Built-in skills shipped with the service
packages/
  agent-contracts/       Shared TypeBox schemas for the service protocol
  agent-client/          HTTP and WebSocket client for the agent service
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

Builds an unsigned app directory for the current platform. On macOS the output is `apps/desktop/release/mac-arm64/AI.app` (`mac` on Intel). The agent service, its production dependencies, and the renderer build are copied into the app resources, together with the official Node.js release pinned by `.node-version` for the build machine's platform and architecture. The first pack downloads that release into `tmp/node-dist/` and checks it against the release's `SHASUMS256.txt`. Each pack also writes a new build ID; a packaged app only reuses a running service with the same build ID and replaces any other. `pnpm --filter @ai/desktop start` runs the production build without packaging.

`pnpm build && pnpm --filter @ai/desktop package:installer` builds the configured installer for the current platform instead (dmg on macOS, nsis on Windows, AppImage on Linux) into `apps/desktop/release/`.

GitHub Actions runs `pnpm check` on Linux, and the Electron smoke suite and app packaging on macOS. Windows and Linux builds have not been verified locally.

### Releases

To release, bump `version` in `apps/desktop/package.json` and merge it into `main` through a pull request. The [Release workflow](.github/workflows/release.yml) builds `AI-<version>-arm64.dmg` and `AI-<version>-x64.dmg` on Apple Silicon and Intel runners, then publishes them as the GitHub Release `v<version>` with generated notes. A version with a suffix such as `1.2.0-beta.1` is published as a prerelease. A merge that leaves the version unchanged builds nothing, and neither does a version whose tag already exists. To release the current version without a bump (such as the first release) or to retry a failed release, run the workflow manually from `main`.

Signing uses these optional repository secrets:

| Secret                                                     | Purpose                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `MAC_CERTIFICATE`, `MAC_CERTIFICATE_PASSWORD`              | Base64 of a Developer ID Application `.p12` and its password, for signing |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization, which also needs the certificate                            |

Without a certificate, the dmg is ad-hoc signed and not notarized. The first launch is then blocked by macOS until the user clicks **Open Anyway** in System Settings → Privacy & Security.

Signed releases also publish the update feed: one `AI-<version>-<arch>-mac.zip` and its blockmap per architecture, and a `latest-mac.yml` merged from both runners. Signed macOS installs check GitHub Releases shortly after launch and every 4 hours, download a new version in the background, and install it at the next quit; **Check for Updates…** and **Restart to Update** are in the menu. Ad-hoc signed releases publish only dmgs, and builds without a Developer ID signature never check for updates, because Squirrel.Mac can only install an update signed by the same team.

## Data and Security

- **Process isolation**: the renderer runs with `contextIsolation` and `sandbox`, and without `nodeIntegration`. External navigation, pop-ups, and permission requests are restricted. The preload exposes a narrow, typed API, and the main process validates the sender and the payload of every IPC call.
- **Local service**: the agent service listens only on loopback and requires a bearer token stored in its data directory. It hosts no web page and has no browser sign-in.
- **Credentials**: provider and MCP secrets are stored in the OS keychain (macOS Keychain, Windows Credential Manager, or Secret Service on Linux). They never reach the renderer or task snapshots. If no persistent keyring is available, the service says so and runs only with temporary credentials from `AI_AGENT_TEMP_*` environment variables, which it never stores.
- **Service lifecycle**: the desktop app starts the service as its child and stops it on quit. When tasks are running, quitting (or restarting to update) first asks whether to stop them; queued tasks stay queued and start the next time the app opens. OS shutdown, logout, and termination signals quit without asking. If the service exits unexpectedly, the app restarts it with an increasing delay. After 3 unexpected exits within 5 minutes it stops trying, and **Restart Agent Service** in the menu starts it again.
- **Open at login**: an opt-in switch in Settings › Shortcuts (packaged macOS and Windows builds). The state lives in the OS login items, not in the app's settings; an app started at login stays in the menu bar without showing the panel.
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
