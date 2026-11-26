# Atd for Chrome

A Manifest V3 extension that makes the person's own Chrome a browser channel of Atd's computer use.
Tasks, approvals and results stay with the Atd app and service; the extension starts tasks from its
panel or the in-page ask, executes in the tabs a task is handed, shows its progress there (HUD, edge
light, pointer), and hands control back and forth. It never holds the service token: it talks only
to the Atd shell, through Native Messaging.

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

| Command                | Does                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm build:extension` | Builds both flavors into `dist/release` and `dist/dev`                                              |
| `pnpm dev:extension`   | Rebuilds `dist/dev` on every change to its sources; the loaded dev extension then reloads by itself |

- Dev reload (`dev-plugins.ts`, `src/background/dev-reload.ts`): each dev build writes a stamp,
  `dev-build.json`, after its other files. The dev service worker reads it every second and reloads
  the extension when it changes, then injects the content script again into the tabs that had one,
  so their pages keep their state; an open panel closes. The watch follows the content script's
  imports (workspace packages included) because crxjs builds it in a separate pass that Vite's
  watcher does not see. A dev extension loaded from a build without this reloads by hand once.
  The release flavor has neither the stamp nor the reloader.
- Load unpacked: `chrome://extensions` → Developer mode → Load unpacked → `dist/dev` (with the Debug
  app) or `dist/release` (with the Release app). Open the matching Atd build once so its shell
  installs the native host manifest; until then the panel reports that Atd is not set up.
- The toolbar button opens the in-page ask in the active tab, and closes it again on a second click.
  On a tab no content script can run in (chrome:// pages, the new tab page, the Web Store, other
  extensions' pages, local files without file access) it opens the panel in Chrome's side panel
  (`side_panel` in the manifest) instead. Where a Chromium browser has no side panel API, the
  service worker sets the panel page as the button's popup (`src/background/action-surface.ts`,
  opened with `?surface=popup`).
- The in-page ask opens in every connection state. While Atd cannot take a request (not
  connected, not paired, or busy with one already) it says why, with send disabled, and offers the
  side panel; its Open side panel control opens the panel for the tab's window at any time.
- Connect from the panel (Connect…), then confirm in Atd: both sides show the same 4-character
  code. Disconnect in Atd's Settings › Computer use.
- The in-page ask's inspector picks elements of the page to send with a request (up to five): the
  element under the pointer is outlined, a click adds it as a chip beside the page chip, and Esc
  stops picking. The page's elements get none of those pointer events, embedded frames included.
  Each element goes to Atd as a unique CSS selector, a short label (role and name) and its visible
  text, read when it is picked, and only together with the page: removing the page chip removes
  them.
- Send a task from the panel's composer: it goes from the tab the window shows, with that page
  (URL and title) while the page chip stays, or without it (always from a tab that is no website,
  where Atd opens the sites it needs). The run, and the reply it ends with, show in the panel and
  in the HUD of the tab it was sent from, where that tab is a web page. The reply is the agent's
  Markdown: the service worker parses it once (`src/rich-text/`, `marked`'s lexer) into a small
  tree that both surfaces render without HTML (raw HTML stays text, an image is its alt text, a
  link keeps only an http(s) or mailto destination). In the HUD a long reply scrolls inside the
  card under an overlay thumb, with edges that fade where it continues; Copy copies the Markdown.
- The ask shortcut (⇧⌘K by default; Ctrl+Shift+K off macOS) does what the toolbar button does. It can be changed at `chrome://extensions/shortcuts`, which also accepts ⌥⌘K: Chrome refuses Alt with Ctrl or Command only as a manifest default.

## Layout

| Path                                     | Role                                                                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/channel/protocol.ts`, `payloads.ts` | K2, the extension ↔ shell channel (TypeBox, `Value.Check` only: MV3 forbids `eval`). The source of truth that the shell's `AIChromeChannelKit` mirrors.                                                                                       |
| `src/messages/`                          | The extension's own contracts: views the service worker projects (`views.ts`) and the intents the content script and panel send (`content.ts`, `panel.ts`).                                                                                   |
| `src/background/`                        | Service worker: native channel (chunk reassembly, backoff), pairing, state and projections, owned tabs, the "Atd" tab group and badge, content-script injection, and the CDP translator with its allowlist (`cdp/`, adapted from Playwright). |
| `src/background/transition-*.ts`         | The page transitions' frames (`captureVisibleTab`) and the gate that holds the agent's screenshots and input while the takeover's ripple plays (`cdp/debuggee.ts` consults it).                                                               |
| `src/content/`                           | Content script (one IIFE, closed Shadow DOM): HUD, in-page ask (`ask/`), edge light (`glow/`, on `@atd/ui/lib/glow`), pointer.                                                                                                                |
| `src/content/inspector/`                 | The in-page ask's inspector: picking an element of the page (capture-phase listeners only while picking), its highlight layer, and the selector, label and text each picked element sends.                                                    |
| `src/content/transition/`                | Page transitions: the takeover's ripple and the done sweep, drawn with WebGL2 over a captured frame of the tab, in their own layer under the light.                                                                                           |
| `src/rich-text/`                         | A run's reply as a tree (`tree.ts`, types only) and its parser (`parse.ts`, service worker only): `marked`'s lexer, sanitized and bounded. The HUD (`content/hud/reply.ts`) and the panel (`panel/rich-text.tsx`) render it.                  |
| `src/panel/`                             | The panel (React) on the apple-design web kit, laid out as a Mac sidebar: Chrome's side panel, or the toolbar popup where a browser has none. A toolbar (connection, More menu with this site's permission), the runs, and the composer.      |
| `src/own-input.ts`                       | Timestamps of the person's input on Atd's own UI (HUD, panel), sent with their requests so the host tells them from input to the page.                                                                                                        |
| `src/i18n/`                              | One i18next namespace per surface (`background`, `hud`, `panel`) in `en` and `zh-CN`; `public/_locales` holds only the manifest strings.                                                                                                      |
| `icons/`                                 | Toolbar and manifest icons per flavor, exported by `node scripts/export-brand.mjs apps/chrome-extension` (never edited by hand).                                                                                                              |

## Permissions

`debugger` (only tabs handed to a run, only while it runs; Chrome shows its debugging infobar, and
Cancel there stops the run), `tabs` and `tabGroups` (the "Atd" group), `scripting` (tabs open before
the extension loaded), `nativeMessaging`, `storage`, `sidePanel` (the panel), and `<all_urls>`
hosts for the HUD and the in-page ask. The same host access lets the service worker capture a tab
(`chrome.tabs.captureVisibleTab`) as the frame its page transitions play over: only a tab a run is in (its HUD shows one, or Atd has just taken
the person's ask with its page there), only while it is the active tab of its window (checked
before and after the capture), at most twice a second, and the frame goes back only to that tab's
document. Pages no content script runs on (chrome://, the Web Store) never
ask; there the toolbar button opens the side panel. No cookies, history, bookmarks, downloads or
webRequest. The content script reads nothing from a page and sends nothing until the person acts.
While the person picks with the inspector it reads the role, name and size of the element under
the pointer for its label; it keeps and sends only the elements they pick (a selector, role and
name, and visible text, never a field's value), read when they pick them.

Commands on selected text are not the extension's: Atd's own selection toolbar serves selections in
Chrome as it does in any other app.

## Generated files

- `src/panel/apple-kit.css` and `src/panel/apple-kit.js` (the kit's script, for its menu):
  `python3 .agents/skills/apple-design/scripts/build_kit.py base type type-macos list switch field button motion menu empty-state scroll-edge --no-layer --css apps/chrome-extension/src/panel/apple-kit.css --js apps/chrome-extension/src/panel/apple-kit.js`,
  then `pnpm exec oxfmt` on both. Never edit them by hand.
- `icons/`: see the brand README (`packages/ui/src/assets/brands/atd/README.md`).

## Not in this package yet

Chrome Web Store publishing and embedding the built extension in the Release app.
