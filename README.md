# Atd

<img src="packages/ui/src/assets/brands/atd/app-icon.png" width="96" alt="Atd app icon" />

**A quiet agent for your Mac.**

Select text, capture your screen, or press **⌘ ⇧ Space** to start a conversation. Atd brings your models, tools, and local context into a small desktop panel—for everyday work, coding tasks, and apps of your own.

**macOS 26+ · Apple silicon · English / 简体中文**

[Download for Mac](https://github.com/JUNERDD/ai/releases/latest) · [UI gallery](#ui-gallery) · [Development](#development) · [Report an issue](https://github.com/JUNERDD/ai/issues)

[![Atd main panel on the desktop, with a new task, composer, model selector, and permission controls](apps/website/public/cases/ui/main-panel.png)](apps/website/public/cases/ui/main-panel.png)

_Main panel, exported from the [project's Figma UI designs](https://www.figma.com/design/PROJECT_FILE_KEY/Atd?node-id=2462-142863)._

## Get started

1. Download the Apple silicon `.dmg` from [GitHub Releases](https://github.com/JUNERDD/ai/releases/latest) and move **Atd** to **Applications**.
2. Open **Settings → Models**, add a provider connection, and choose your default provider and model. Connect with a supported account sign-in, API key, or local endpoint.
3. Press **⌘ ⇧ Space** to open the panel. Ask a question, attach a file, or start from selected text or a screenshot.

The app is currently ad hoc signed and not notarized. If macOS blocks the first launch, open **System Settings → Privacy & Security → Open Anyway**. The selection toolbar asks for Accessibility access; screen capture asks for Screen Recording access.

The release app bundles its agent service and Node.js runtime. You do not need the development toolchain to use Atd. Tools invoked by a task still need to be available on your Mac.

### Shortcuts

| Action                 | Default shortcut |
| ---------------------- | ---------------- |
| Show or hide the panel | ⌘ ⇧ Space        |
| Take a screenshot      | ⌘ ⇧ 2            |
| New conversation       | ⌘ N              |
| Open settings          | ⌘ ,              |
| Send a message         | Enter            |
| Insert a new line      | Shift + Enter    |

Change these in **Settings → General**. The menu bar icon remains another way to open the panel. The interface follows your OS language on first launch; choose English or Simplified Chinese in settings.

## What you can do

- **Bring the right context.** Use selected text, annotated screenshots, attachments, `@` file mentions, or drag files onto the Mini Panel.
- **Follow the work.** Streamed conversations show tool activity, file diffs, terminal output, web results, todo lists, and subagent activity. Continue a task with a follow-up, or stop an active run.
- **Use your models.** Connect cloud, local, and custom providers. Each connection has its own credentials and default model; existing tasks retain their model selection.
- **Make work reusable.** Save commands with parameters and shortcuts. Add skills, subagents, and MCP servers individually or through [supported plugin bundles](packages/plugin-kit/README.md).
- **Build personal apps.** Describe a small tool, create it in a conversation, and open it from **My apps**. Apps can have an independent window, their own backend, and desktop widgets; return to the task to refine them.
- **Run work automatically.** Schedule prompts or saved commands, react to folder changes, run when your Mac is idle, or chain work after another automation. Inspect status and run history, and pause automations from settings.
- **Keep control.** Set permissions per task, manage the shell allowlist, review stored memories, and pause memory learning.

Automations run while Atd is running. Unattended tasks decline actions that require approval instead of waiting for a response. Missed schedules can run once on return or be skipped. New installations include an editable **Consolidate memory** automation that runs at most once a day after two hours of Mac inactivity.

## UI gallery

The screenshots below are exact **1440 × 900** exports from the project's UI design frames, built with connected Figma components and a shared desktop background. Together with the main panel above, they show eight interfaces. Click an image to open the original.

### Selection and quick actions

| Selection toolbar                                                                                                                                                                                           | Mini Panel                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [![Selection toolbar with Ask Atd, Translate, Summarize, and Explain actions beside selected text](apps/website/public/cases/ui/selection-toolbar.png)](apps/website/public/cases/ui/selection-toolbar.png) | [![Expanded Mini Panel at the edge of the desktop with its saved-command menu](apps/website/public/cases/ui/mini-panel.png)](apps/website/public/cases/ui/mini-panel.png) |
| Ask, translate, summarize, or explain from a text selection.                                                                                                                                                | Open a task, capture the screen, or run a saved command.                                                                                                                  |

### Capture and conversation

| Screenshot tool                                                                                                                                                                | Conversation                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [![Screenshot selection with arrows, step numbers, mosaic, and annotation controls](apps/website/public/cases/ui/screenshot.png)](apps/website/public/cases/ui/screenshot.png) | [![Conversation with a follow-up message, tool activity, response actions, and composer](apps/website/public/cases/ui/chat.png)](apps/website/public/cases/ui/chat.png) |
| Capture an area and mark the details that matter.                                                                                                                              | Read the result and keep working in the same task.                                                                                                                      |

### Your setup and your apps

| Models and settings                                                                                                                                                                    | My apps                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [![Models settings with a navigation sidebar and ChatGPT, Anthropic, and LM Studio connections](apps/website/public/cases/ui/settings.png)](apps/website/public/cases/ui/settings.png) | [![My apps alongside an independent Notes application window](apps/website/public/cases/ui/apps.png)](apps/website/public/cases/ui/apps.png) |
| Configure providers, models, permissions, and preferences.                                                                                                                             | Turn an idea into an app you can open again.                                                                                                 |

### Automations

Scheduled tasks, folder workflows, and idle-time memory consolidation, with run status and a shared pause control.

[![Automations settings showing memory consolidation, a folder-triggered invoice workflow, scheduled tasks, and pause controls](apps/website/public/cases/ui/automations.png)](apps/website/public/cases/ui/automations.png)

The README and [website](apps/website/README.md) reference the same checked-in images. [Asset provenance and export instructions](apps/website/public/cases/README.md) link every image to its source Figma frame.

## Development

### Requirements

| Tool                   | Version / source                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| macOS                  | 26 or later, on Apple silicon                                                               |
| Xcode                  | 26; CI uses 26.3                                                                            |
| Node.js                | **24.21.0**, pinned in [`.node-version`](.node-version)                                     |
| pnpm                   | **12.8.1**, pinned in [`package.json`](package.json)                                        |
| XcodeGen and SwiftLint | Install with `brew install xcodegen swiftlint`                                              |
| Rust                   | Install rustup; [`rust-toolchain.toml`](rust-toolchain.toml) pins Rust, rustfmt, and Clippy |

### Run the app

```sh
git clone https://github.com/JUNERDD/ai.git
cd ai
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` builds the service's workspace dependencies, starts the local agent service and Vite renderer, builds the native Debug app, and opens it when both servers are ready. It installs a development copy at `~/Applications/Atd Dev.app` so macOS can register its widgets. This copy remains after development stops and carries a `DEV` icon.

The renderer hot-reloads. Changes under `apps/agent-service/src` restart the service and interrupt active runs; changes to other workspace packages or the Swift shell require restarting development. **Ctrl + C** stops the development processes and the app that this command opened.

The renderer is hosted by the native app. A browser opened at its Vite origin shows a host-required notice. Configure a development model connection in **Settings → Models** before running a task.

### Development commands

Run these from the repository root:

| Command                            | Purpose                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `pnpm dev`                         | Start the service, renderer, and native Debug app               |
| `pnpm dev:headless`                | Start the service and renderer                                  |
| `pnpm dev:renderer`                | Start only the renderer dev server                              |
| `pnpm --filter @atd/macos build`   | Build the native Debug app                                      |
| `pnpm --filter @atd/desktop build` | Build the renderer into `apps/desktop/dist-native`              |
| `pnpm dev:website`                 | Start the independent marketing site at `http://127.0.0.1:5180` |
| `pnpm preview:website`             | Build and preview the static marketing site                     |

The native renderer uses port **5173**. Run one renderer dev command at a time. To use a different free port, set `AI_RENDERER_PORT` and give the Debug app the matching origin in `AI_RENDERER_DEV_ORIGIN`.

The website serves English at `/` and Chinese at `/zh`. Its [README](apps/website/README.md) covers site structure, UI assets, and deployment.

### Development data and debugging

| Build               | Data directory on macOS                          |
| ------------------- | ------------------------------------------------ |
| Installed / Release | `~/Library/Application Support/AgentService`     |
| Development         | `~/Library/Application Support/AgentService Dev` |
| Isolated run        | The directory set by `AI_AGENT_DATA_DIR`         |

To work with an empty temporary data directory:

```sh
AI_AGENT_DATA_DIR="$(mktemp -d)" pnpm dev
```

The Debug app receives that directory and connects to the matching development service. It never starts a service of its own. Development credentials are separate from the installed app; provider and MCP secrets must be configured for that service.

The Debug web view is inspectable through **Safari → Develop → your Mac → Atd**, after enabling **Show features for web developers** in Safari's advanced settings.

Debug uses bundle ID `com.junerdd.ai.dev`; Release uses `com.junerdd.ai`. Test a local Release build with the installed app quit and a temporary data directory, because both Release copies share the same bundle ID.

### Agent service CLI

After building `@atd/agent-service` and its dependencies, run the CLI from `apps/agent-service`:

```sh
node dist/cli.js --help
```

| Command                  | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `serve`                  | Start the service on loopback; `--port 0` chooses a free port |
| `status`                 | Read the running service's status                             |
| `stop`                   | Stop the matching service                                     |
| `approve mcp <serverId>` | Inspect an MCP launch and approve it interactively            |

The service exposes an authenticated `/v1` API and hosts no web page. Use `--dataDir` or `AI_AGENT_DATA_DIR` to select an isolated service; the environment variable takes precedence.

## How it is built

Atd has three main parts: a **Swift/AppKit shell** for windows and native capabilities, a **React renderer** hosted in WKWebView, and a **local agent service** built on the [pi SDK](https://github.com/earendil-works/pi). The shell relays renderer requests to the service, keeping the bearer token out of the page.

```text
apps/
  macos/              Swift shell, Liquid Glass windows, OS integration, widgets
  desktop/            React UI, client state, localization, native bridge
  agent-service/      Tasks, providers, tools, automations, memory, apps, plugins
  website/            Vite + React marketing site, prerendered in English and Chinese
packages/
  agent-contracts/    Shared TypeBox schemas for the service protocol
  agent-client/       HTTP and WebSocket client
  app-kit/            Personal-app SDK, build tools, runtime, and starter template
  plugin-kit/         Plugin installation, normalization, and catalog resolution
  file-index/         Node package for the Rust file index
  ui/                 Shared shadcn components, theme tokens, and brand assets
  typescript-config/  Shared TypeScript configuration
crates/               Rust file index and Node binding
scripts/              Development tooling and repository checks
docs/                 Design sources and implementation plans
```

The UI uses **React 19, Tailwind CSS 4, shadcn Radix/Rhea, and Lucide**. The service uses **Fastify, TypeBox, pi coding-agent / pi-ai / pi-mcp 1.0.0**, and a service-owned memory engine. Tooling includes **Vite 8, TypeScript 7, pnpm, Turborepo, Oxlint, Oxfmt, Vitest, Swift Testing, and Cargo**. Exact dependencies are recorded in each package manifest and `pnpm-lock.yaml`.

## Checks and releases

### Validation

```sh
pnpm check
```

This runs formatting, lint, type checks, tests, and builds for the non-native packages. On macOS it also runs the Swift and Rust checks.

| Command             | Scope                                            |
| ------------------- | ------------------------------------------------ |
| `pnpm format:check` | Repository formatting outside Swift and Rust     |
| `pnpm lint`         | Workspace Oxlint checks and native SwiftLint     |
| `pnpm typecheck`    | TypeScript                                       |
| `pnpm test`         | Vitest, service tests, and Swift Testing         |
| `pnpm build`        | Workspace builds, including the native Debug app |
| `pnpm check:swift`  | Swift formatting, lint, tests, and Debug build   |
| `pnpm check:rust`   | Rust file length, formatting, Clippy, and tests  |
| `pnpm check:macos`  | Swift and Rust checks                            |

CI runs the non-native checks on Linux and the Swift and Rust checks on macOS 26 with Xcode 26.3.

### Build a release

```sh
pnpm --filter @atd/macos build:release
```

The output is `apps/macos/DerivedData/Build/Products/Release/Atd.app`. The command builds the service and renderer, stages production dependencies, and embeds the official Node.js runtime pinned by `.node-version`. Use the complete command so the app includes current renderer and service output.

The [release workflow](.github/workflows/release.yml) publishes an Apple silicon `.dmg` when a version bump in `apps/macos/package.json` reaches `main`. Keep that version aligned with `MARKETING_VERSION` in `apps/macos/project.yml` and `apps/desktop/package.json`. A manual run can publish the current version when its tag is absent.

Releases include a signed Sparkle `appcast.xml` update feed. Release apps use that feed for updates; Debug apps do not update themselves. See [GitHub Releases](https://github.com/JUNERDD/ai/releases) for published builds.

## Data and permissions

- **Local storage.** Task history, settings, and memories live in the service data directory on your Mac.
- **Model and tool access.** Requests go to the model providers you configure. Tools and MCP servers can access the files or external services allowed by their configuration and the task's permissions.
- **Credentials.** Provider and MCP secrets live in the OS keychain and do not reach the renderer or task snapshots.
- **Approval controls.** Each task can use Manual approval, Auto approval, or Always allow. Settings also owns the shell allowlist and memory-learning controls.
- **Native isolation.** The page communicates through a typed native bridge and an authenticated relay. The service listens on loopback; the renderer never holds its bearer token.
- **Lifecycle and logs.** Release starts its bundled service and stops it on quit. Service logs are in `~/Library/Logs/AI/`; **Show Service Logs** in the menu reveals them.

## Design and contributing

- [Project Figma file](https://www.figma.com/design/PROJECT_FILE_KEY/Atd): application screens and project components.
- [Shared shadcn UI kit](https://www.figma.com/design/UI_KIT_FILE_KEY/shadcn-ui-kit-community-edition--Community-): shared controls and Lucide icons.
- [Design-to-code mapping](docs/design-source.md): component and token ownership.
- [UI screenshot sources](apps/website/public/cases/README.md): exact exports shared by this README and the website.
- [Contributor guidelines](AGENTS.md): repository constraints, validation, and design synchronization.

Read the contributor guidelines before making changes. Keep changes scoped, run the relevant checks, and submit a pull request targeting `main`. Include reproduction steps and the expected result when [reporting an issue](https://github.com/JUNERDD/ai/issues).
