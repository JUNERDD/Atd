# AI

A quiet desktop agent panel. It sits in the bottom-right corner of the screen, opens with a global shortcut, and runs coding and general-purpose agent tasks on your machine.

The app has two parts. A desktop client provides the floating panel and a settings window. A local agent service built on the [pi](https://github.com/earendil-works/pi) SDK runs the tasks, stores data, and handles credentials.

The released client (0.2.x) is built with Electron. A native macOS client in `apps/macos` is replacing it: a Swift/AppKit shell with Liquid Glass windows that hosts the same React UI in a WKWebView and relays its service requests, so the page never holds the service token. It needs macOS 26 on Apple silicon, starts at version 0.3.0, and the Electron app is removed once the native one reaches feature parity.

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
- For the native app and the full check: macOS 26 on Apple silicon, Xcode 26, [XcodeGen](https://github.com/yonaskolb/XcodeGen), and [SwiftLint](https://github.com/realm/SwiftLint) (`brew install xcodegen swiftlint`), plus [rustup](https://rustup.rs) for the Rust file index; `rust-toolchain.toml` pins the toolchain.
- At runtime, unpackaged builds (`pnpm dev`, `pnpm dev:electron`, `pnpm --filter @ai/desktop start`) run the agent service with the system Node.js on `PATH`. Packaged apps ship their own Node.js and need nothing installed. The Electron binary is never used as Node.
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

`pnpm dev` builds the workspace packages the service imports, then starts two things: the agent service from source, and the Vite renderer dev server (`--mode native`). It does not start a desktop app. The service restarts within a few seconds when a file under `apps/agent-service/src` changes, which interrupts runs in progress; changes to other workspace packages need a restart of `pnpm dev`. Press **Ctrl + C** to stop everything.

The development service keeps its data in its own directory, separate from the installed app (see [Development data](#development-data)). The native Debug app connects to it, and a browser can open the renderer at <http://127.0.0.1:5173/?preview>.

To run a real model, open Settings → Providers, add a working connection, choose a default model, and make that connection the default provider.

### Development data

`pnpm dev` runs the service in `~/Library/Application Support/AgentService Dev`. `AI_AGENT_DATA_DIR` still takes precedence, for example `AI_AGENT_DATA_DIR=$(mktemp -d) pnpm dev` for a throwaway service. The default directory, `~/Library/Application Support/AgentService`, belongs to the installed app; no development command uses it.

The development directory starts empty. To start from your real tasks and settings instead, quit the installed app (its service stops with it), copy the default directory, and remove the copy's service identity, token, and runtime files:

```sh
dev="$HOME/Library/Application Support/AgentService Dev"
cp -R "$HOME/Library/Application Support/AgentService" "$dev"
rm -f "$dev/service.json" "$dev/auth/token" "$dev/endpoint.json" "$dev/service.lock"
```

Run the copy only while `$dev` does not exist yet; otherwise `cp` nests the copy inside it. The next `pnpm dev` creates a new service ID. Secrets are stored in the macOS Keychain under that ID (`ai-agent-service:<serviceId>`) and are not part of the copy, so enter them again in development: provider API keys and browser sign-ins, MCP server secrets, and sensitive plugin settings. Without the removal, the development service would share the installed app's Keychain entries, and deleting a key in development would delete it for the installed app too.

### Native app

```sh
pnpm --filter @ai/macos build
```

The native app is still in development and not yet at feature parity; this describes the workflow it follows. The command generates the Xcode project from `apps/macos/project.yml` and builds the Debug app into `apps/macos/DerivedData/Build/Products/Debug/AI.app`. The Debug app has the bundle ID `com.junerdd.ai.dev`, so it keeps its own Accessibility permission and never collides with the installed app. It never starts the service: each time it connects, it reads `endpoint.json` and the token from the development data directory and connects to the service `pnpm dev` runs. Without one, it asks you to run `pnpm dev`. To pair it with a throwaway service, give both the same directory: `open --env AI_AGENT_DATA_DIR=<dir> apps/macos/DerivedData/Build/Products/Debug/AI.app`.

The Debug web view is inspectable: in Safari, turn on Settings → Advanced → **Show features for web developers**, then open Develop → your Mac → AI.

Release builds (`com.junerdd.ai`) start their own bundled service. Before the switch from Electron, test one only with the installed Electron app quit and a separate data directory: `open --env AI_AGENT_DATA_DIR=<dir> AI.app`.

### Electron app

```sh
AI_TEST_USER_DATA=$(mktemp -d) pnpm dev:electron
```

Runs the Electron app in development, as `pnpm dev` did before: Vite with Electron, a hot-reloading React UI, and an Electron restart when the main process or preload changes. The app starts its own agent service, which does not reload when service code changes; restart `pnpm dev:electron` for that. It refuses to start without `AI_TEST_USER_DATA`, which isolates its profile and service data: otherwise its service would take over the installed app's data directory. It also refuses to start while `pnpm dev` runs, and `pnpm dev` refuses while it runs, because both need the renderer port and must not share a service.

### Renderer preview

To check layout, styling, and copy without Electron:

```sh
pnpm dev:renderer
```

Then open <http://127.0.0.1:5173/?preview> in a browser. The page is the bare React UI: it does not connect to an agent service, and there is no browser client for real data. `pnpm dev`, `pnpm dev:electron`, and `pnpm dev:renderer` use the same port (5173), so run only one of them at a time.

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
  macos/                 Native macOS shell: Swift package, XcodeGen app target, Swift tests
  desktop/               React renderer, plus the Electron app until the native one replaces it
    electron/            Windows, IPC, settings, shortcuts, service launcher
    src/                 React UI, features, i18n
    tests/               Vitest setup and the Playwright Electron smoke suite
  agent-service/         Local agent service (Fastify HTTP + WebSocket, pi SDK)
    src/                 Tasks, providers, credentials, MCP, skills, subagents, memory
    product-skills/      Built-in skills shipped with the service
crates/                  Rust file index and its Node binding (Cargo workspace)
packages/
  agent-contracts/       Shared TypeBox schemas for the service protocol
  agent-client/          HTTP and WebSocket client for the agent service
  ui/                    Shared shadcn components, theme tokens, brand assets
  typescript-config/     Shared TypeScript configuration
patches/                 pnpm patches for pinned pi extensions
scripts/                 Dev-script guard and repository checks
docs/                    Design sources, plans, and screenshots
```

## Tech Stack

| Area            | Choice                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Native shell    | Swift 6, AppKit, WKWebView, XcodeGen, Swift Testing, `swift format`, SwiftLint                                       |
| Desktop         | Electron 44, Vite 8 (Rolldown, Oxc), `vite-plugin-electron`                                                          |
| UI              | React 19, Tailwind CSS 4, shadcn (Radix / Rhea preset `b27GcrRo`), Lucide, Inter                                     |
| Editor & render | CodeMirror 6, Streamdown, `@pierre/diffs`, `@pierre/trees`                                                           |
| Agent runtime   | `@earendil-works/pi-coding-agent` and `pi-ai` 0.87.1, pi extensions for memory, MCP, subagents, web tools, and todos |
| Service         | Fastify 5, `@fastify/websocket`, TypeBox, `@napi-rs/keyring`                                                         |
| File index      | Rust (pinned by `rust-toolchain.toml`), napi-rs                                                                      |
| Tooling         | pnpm workspaces, Turborepo, TypeScript 7, Oxlint, Oxfmt, Vitest, Playwright                                          |

All direct dependencies use exact versions, and installs use `pnpm-lock.yaml`. See each `package.json` for exact versions.

## Checks and Packaging

```sh
pnpm check
```

Runs the format check, Oxlint, TypeScript, the tests, and the production build for every package except the native app. On macOS it then runs `pnpm check:macos`; on other systems it skips that step. You can also run each step on its own:

| Command             | Runs                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm format:check` | Oxfmt over the repository                                                                             |
| `pnpm lint`         | Oxlint in every package, and SwiftLint in `apps/macos`                                                |
| `pnpm typecheck`    | TypeScript                                                                                            |
| `pnpm test`         | Vitest, the service tests, and Swift Testing                                                          |
| `pnpm build`        | Every package, including the Debug native app                                                         |
| `pnpm check:swift`  | `swift format` lint, SwiftLint, Swift Testing, and the Debug build of `apps/macos`                    |
| `pnpm check:rust`   | The 350-line limit for `.rs` files, `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test` |
| `pnpm check:macos`  | `check:swift`, then `check:rust`                                                                      |

```sh
pnpm test:electron
```

Builds the app and runs the Playwright smoke suite against a real Electron window in a temporary profile.

```sh
pnpm package
```

Builds an unsigned app directory for the current platform. On macOS the output is `apps/desktop/release/mac-arm64/AI.app` (`mac` on Intel). The agent service, its production dependencies, and the renderer build are copied into the app resources, together with the official Node.js release pinned by `.node-version` for the build machine's platform and architecture. The first pack downloads that release into `tmp/node-dist/` and checks it against the release's `SHASUMS256.txt`. Each pack also writes a new build ID; a packaged app only reuses a running service with the same build ID and replaces any other. `pnpm --filter @ai/desktop start` runs the production build without packaging.

`pnpm build && pnpm --filter @ai/desktop package:installer` builds the configured installer for the current platform instead (dmg on macOS, nsis on Windows, AppImage on Linux) into `apps/desktop/release/`.

GitHub Actions runs `pnpm check` on Linux, where it skips the Swift and Rust checks. A macOS 26 runner with Xcode 26.3 runs the Electron smoke suite, `pnpm check:swift`, `pnpm check:rust`, and app packaging; it installs XcodeGen and SwiftLint with Homebrew when the image lacks them, and the Rust toolchain from `rust-toolchain.toml`. Windows and Linux builds have not been verified locally.

### Releases

Releases are paused. The Electron release is disabled, so bumping `version` in `apps/desktop/package.json` publishes nothing; the native app's release (starting at 0.3.0) replaces it later. The rest of this section describes the disabled workflow, which the native release is expected to follow.

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

  `AI_AGENT_DATA_DIR` overrides this location. `pnpm dev` and the native Debug app use `~/Library/Application Support/AgentService Dev` instead (see [Development data](#development-data)). `AI_TEST_USER_DATA` gives the Electron app an isolated profile with its own service data, which is useful for debugging without touching your real data.

- **Window material**: the native app uses Liquid Glass (`NSGlassEffectView`) behind a transparent web view; the Electron app uses HUD vibrancy on macOS. The system draws the corners, edge highlight, and shadow; the renderer keeps its root transparent and paints a single token-based content surface. Menus, popovers, and dialogs inside the page share one glass material that blurs the page behind them. Browser previews and other platforms use a translucent CSS surface instead.
- **CSP**: production builds use a strict Content Security Policy. Only the local dev server allows the inline script that React Fast Refresh needs.

## Design

Screens and project components live in the [project Figma file](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5/ai). Shared controls and Lucide icons come from the approved [shadcn UI kit](https://www.figma.com/design/tEV8H6Msibbc64Dds5eehO/shadcn-ui-kit-community-edition--Community-). Brand SVGs are kept in `packages/ui/src/assets/brands/`.

To add a shadcn component:

```sh
pnpm dlx shadcn@4.21.0 add dialog -c apps/desktop --yes
```

Components are generated into `packages/ui/src/components`. After running the CLI, check the import paths and any dependency changes.

For the design-to-code mapping, see [docs/design-source.md](docs/design-source.md). Implementation plans are in [docs/plans/](docs/plans/). Contributor and agent guidelines are in [AGENTS.md](AGENTS.md).
