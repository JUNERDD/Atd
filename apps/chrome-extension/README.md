# Atd for Chrome

A Manifest V3 extension that makes the person's own Chrome a browser channel of Atd's computer use.
Tasks, approvals and results stay with the Atd app and service; the extension executes in the tabs
a task is handed, shows its progress there (HUD, edge light, pointer), and hands control back and
forth. It never holds the service token: it talks only to the Atd shell, through Native Messaging.

## Flavors

One source builds two extensions. Each pairs with one Atd build, whose shell installs the native
host manifest that admits only that extension ID (`flavors.ts`).

| Flavor    | Name                 | Native host                  | Extension ID                       | Atd build |
| --------- | -------------------- | ---------------------------- | ---------------------------------- | --------- |
| `release` | Atd for Chrome       | `com.junerdd.atd.chrome`     | `lcjihbdaipfphmofnhlocknjpnocbjbf` | Release   |
| `dev`     | Atd for Chrome (Dev) | `com.junerdd.atd.chrome.dev` | `eolengaocpdgjapbjdfpfcokjpgjaedi` | Debug     |

The manifest `key` (public half) fixes the ID of an unpacked load; the private halves were never
kept, so the extension cannot be re-signed with them.

## Build and load

From the repository root (or `pnpm --filter @atd/chrome-extension build` / `dev` directly):

| Command                | Does                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `pnpm build:extension` | Builds both flavors into `dist/release` and `dist/dev`                                |
| `pnpm dev:extension`   | Rebuilds `dist/dev` on change; reload the extension in `chrome://extensions` after it |

- Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → `dist/dev` (with the Debug
  app) or `dist/release` (with the Release app). Open the matching Atd build once so its shell
  installs the native host manifest; until then the popup reports that Atd is not set up.
- Connect from the toolbar popup (Connect…), then confirm in Atd: both sides show the same
  4-character code. Disconnect in Atd's Settings › Computer use.
- The ask shortcut (⇧⌘K by default; Ctrl+Shift+K off macOS) can be changed at `chrome://extensions/shortcuts`, which also accepts ⌥⌘K: Chrome refuses Alt with Ctrl or Command only as a manifest default.

## Layout

| Path                                     | Role                                                                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/channel/protocol.ts`, `payloads.ts` | K2, the extension ↔ shell channel (TypeBox, `Value.Check` only: MV3 forbids `eval`). The source of truth that the shell's `AIChromeChannelKit` mirrors.                                                                                       |
| `src/messages/`                          | The extension's own contracts: views the service worker projects (`views.ts`) and the intents the content script and popup send (`content.ts`, `popup.ts`).                                                                                   |
| `src/background/`                        | Service worker: native channel (chunk reassembly, backoff), pairing, state and projections, owned tabs, the "Atd" tab group and badge, content-script injection, and the CDP translator with its allowlist (`cdp/`, adapted from Playwright). |
| `src/content/`                           | Content script (one IIFE, closed Shadow DOM): HUD, in-page ask, edge light (`glow/`, on `@atd/ui/lib/glow`), pointer.                                                                                                                         |
| `src/popup/`                             | Toolbar popup (React) on the apple-design web kit.                                                                                                                                                                                            |
| `src/i18n/`                              | One i18next namespace per surface (`background`, `hud`, `popup`) in `en` and `zh-CN`; `public/_locales` holds only the manifest strings.                                                                                                      |
| `icons/`                                 | Toolbar and manifest icons per flavor, exported by `node scripts/export-brand.mjs apps/chrome-extension` (never edited by hand).                                                                                                              |

## Permissions

`debugger` (only tabs handed to a run, only while it runs; Chrome shows its debugging infobar, and
Cancel there stops the run), `tabs` and `tabGroups` (the "Atd" group), `scripting` (tabs open before
the extension loaded), `nativeMessaging`, `storage`, and `<all_urls>` hosts for the HUD. No
cookies, history, bookmarks, downloads or webRequest. The content script reads nothing from a page
and sends nothing until the person acts.

Commands on selected text are not the extension's: Atd's own selection toolbar serves selections in
Chrome as it does in any other app.

## Generated files

- `src/popup/apple-kit.css`:
  `python3 .agents/skills/apple-design/scripts/build_kit.py base type type-macos list switch field button motion --no-layer --css apps/chrome-extension/src/popup/apple-kit.css`,
  then `pnpm exec oxfmt` on it. Never edit it by hand.
- `icons/`: see the brand README (`packages/ui/src/assets/brands/atd/README.md`).

## Not in this package yet

Chrome Web Store publishing and embedding the built extension in the Release app.
