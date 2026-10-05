---
name: create-app
description: Build a small personal desktop app inside Atd, or change one already built here, by writing its source and publishing it with the app tool. An app is a React window with an optional backend of its own and optional desktop widgets, saved under My Apps and opened as a window of this product. Applies when the user wants a lasting tool they will open again, whether they describe the screen, the data it keeps, or only the problem it should solve, and when they want an existing app of theirs refined, extended or fixed. Does not apply to editing this repository's own code, to one-off answers or calculations, to documents, scripts or files the user only wants as files, or to websites and projects meant to be run outside Atd.
---

You help the user turn an idea into a working app that lives inside Atd, and keep improving it with them. The service owns the toolchain: you write source files and publish them with the `app` tool. You never install packages, write build configuration or start servers.

Three references hold the details; read them before writing code, and again when a build rejects something:

- `references/sdk.md` (relative to this skill's directory): the page SDK, the backend context, the widget view-tree builders and every limit.
- `references/starter.md`: what `app scaffold` creates, the manifest fields, which parts to keep, the app's own tokens, and the hash router recipe.
- `references/example.md`: one compact finished app and how its look was decided, to calibrate against.

## Shape of an app

An app is one source tree, `app/` in the task folder:

```
app/
  atd-app.json   name, description, accent color, window size, capabilities and why each is needed
  icon.svg       64x64 viewBox, simple and recognizable, drawn in the accent color
  web/           React page (index.html, src/main.tsx, App.tsx, styles.css)
  server/        optional: index.ts default-exports defineBackend({ api, widgets, onStart })
  shared/        typebox schemas and types used by both sides
```

The page runs in its own window and reaches the backend only through `createApi` from `@atd/app-kit/client`. The backend runs as a sandboxed Node process, keeps its data in SQLite (`ctx.db`), a key-value store (`ctx.kv`) or files (`ctx.files`), and reaches Atd's AI, agent, memory, MCP and web features through `ctx`. Skip `server/` when the app is pure UI; add it when the app needs to remember something, call the network, use a model, or feed a widget.

## Workflow

1. **Understand the request.** Infer what you can, and ask the user with `ask_user` only for what would change the design: what the app keeps, what it must do on first open, whether it needs AI or the web. Offer concrete options with the recommended one first. For a request with many screens or several data models, settle the scope in one short round first, then build the smallest useful version; the plan-mode skill is something only the user can start from the panel, so suggest it only when the request is truly large.
2. **Check what exists.** Call `app` `list` when the request could refer to an app that already exists, and work on that one instead of creating a duplicate. Continuing an app means editing `app/` in the task that holds its source: the task that created it, or the task the user starts with Continue editing from My Apps, which begins with the latest source already in `app/`. When `list` shows the app but this task has no `app/`, you have no source to change; tell the user to use Continue editing instead of rewriting the app from memory.
3. **Design the app's look from its purpose.** Each app should look like itself, not like the starter or the previous app. Before writing UI, decide what the request leaves open; when the user has described a look, or is changing an app whose look they already have, keep to that instead.
   - **Layout:** name the primary task, what the user looks at or does most while the app is open, and give it the most space and the first position; everything else recedes. Controls above a list of cards is one outcome of this, right when browsing that list is the job, not a default.
   - **Identity:** choose an `accentColor` that suits the subject and draw `icon.svg` in it. The build applies it to the page's primary color, focus ring and first chart color in light and dark appearance, and the app's widgets take it as `accent`.
   - **Emphasis:** what the user came for gets size and weight, with tabular numerals when it is a changing number; supporting text stays small and muted.
   - **Motion:** animate changes the user should notice, such as a value updating or a selection moving, briefly and with `motion`, and drop the movement when the system asks for reduced motion.
   - **Surfaces:** group by meaning. The primary task may get a surface of its own while the rest stays on the page background; not every item needs a card or a border.
4. **Start from the scaffold, then write the app.** For a new app, call `app` `scaffold` first: it copies the working Notes starter into `app/` when that folder is missing or empty, and answers with the files it created (it never overwrites an existing `app/`). Then replace the starter's content with the user's app: manifest first, then the shared schemas, the backend, the page laid out to your design, and the icon; delete starter files you no longer use. `references/starter.md` says what each scaffolded file contains and which parts to keep. Keep files small and split by responsibility.
5. **Build early and often.** Call `app` `build` with a one-line `summary` as soon as the app runs, then after every runnable change. A failed build creates no version: read the errors, fix the cause and build again. A successful build reports type errors as diagnostics without blocking, so treat them as bugs and fix them in the next build.
6. **Test the backend yourself.** Use `app` `call` with real inputs on each api function you wrote, including an invalid input, and check the results against what the page expects. After the user opens the app, `app` `diagnostics` shows frontend errors, backend crashes and rejected widgets; read it whenever the user reports a blank window or something broken.
7. **Iterate.** Each follow-up in the same task is another change and another build, which becomes a new version. Say what changed in the summary. Tell the user when a capability they have not granted will ask for their consent on first use.

## What good looks like

- **Frontend.** Functional React components, `@atd/ui` components for every control, list and dialog, and lucide-react for icons. Components style with semantic tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, `border`, `text-destructive`), so light and dark appearance and the accent reach everything. Raw colors appear only inside token definitions in `web/src/styles.css`, each with a light and a dark value, and components use those tokens. The accent stands at least 3:1 against the page, enough for icons, indicators and large text; body-size text stays on the foreground tokens. Keep Rhea's compact density: default control sizes, tight spacing, no oversized empty areas. Make the window layout adapt to its width and height; the content scrolls inside its own region while headers and primary actions stay reachable. Name every control (an icon-only button gets an `aria-label`), keep focus visible, and announce results that arrive later with `aria-live`. Design real loading, empty and error states, not only the happy path. Use `@tanstack/react-query` for backend calls.
- **Backend.** Define every api function with a typebox schema from `shared/`, and validate the input with `Value.Parse` before using it. Create and migrate tables in `onStart` with `IF NOT EXISTS` and additive changes only: the data directory is shared by every version and is not rolled back when the user reverts a version, so an older version must still start against data a newer one wrote. Publish a `ctx.events` message when data changes so other open windows refresh. Throw an `Error` with a message the user can act on; it reaches the page as an `AppApiError`.
- **Capabilities.** List in `atd-app.json` only the capabilities the backend really uses, each with a `purposes` line in plain language, because the user is asked to consent to each one the first time it is used and can revoke it later. A backend request for an unlisted capability fails. Storage, files and logging need no capability. Prefer `ctx.ai` for text generation; use `ctx.agent.run` only when the app needs tools or skills, since its side effects go through the user's permission gate.
- **Widgets.** Add one only when a glance at the desktop has real value for the user, such as today's items, a streak or a count, and not as decoration. Fit the content to the size: small shows one number or two or three short rows, medium four rows or a number with a short list, large a list of up to eight rows or a chart. Set `refreshMinutes` to 15 or more, as high as the data allows, and call `ctx.widgets.reload(id)` after the data a widget shows changes. Color what carries the app's identity with `accent`, which is the app's accentColor. The widget picker lists every widget of every app without filtering by size, so declare only the families a widget renders well and make it good in each one. A tap or a `link` opens the app window with the route in `location.hash` (`#/notes/3`), and in an already open window it arrives as a `hashchange`; when any widget uses a route, give the page a tiny hash router that reads `location.hash` at startup and on `hashchange` (no router package is available). Widgets are native views built with `w.*`, not HTML, and their limits are in `references/sdk.md`.
- **Finish.** Give the app a name a person would search for, a one-sentence description, a window size that suits the content, and an icon drawn in its accent color. Finish with a short message to the user: what the app does, anything they must grant or know, and what you suggest next.

## Hard constraints

The build rejects or the runtime blocks these; do not try to work around them.

- Import only allow-listed packages. The page may use react, react-dom, `@atd/ui`, lucide-react, motion, `@tanstack/react-query`, typebox and tailwindcss, plus `@atd/app-kit/client`. The backend may use typebox, `@atd/app-kit/server` and `node:` built-ins. There is no way to add a package; when something seems to need one, write a small version of it or reshape the feature.
- Code is type-checked strictly with verbatim module syntax: import types with `import type` (or `type` specifiers) and write relative imports with their `.ts` or `.tsx` extension.
- Write no configuration files: `package.json`, lockfiles, `vite.config.*`, `tailwind.config.*`, `postcss.config.*`, `tsconfig*.json` and `pnpm-workspace.yaml` are rejected, and so are hidden files, symbolic links, `node_modules`, executable files and the CSS directives `@plugin`, `@config`, `@source` and `@reference`. The source may total at most 16 MiB, with files of at most 8 MiB.
- The page cannot reach the network. Cross-origin requests, remote scripts, fonts, images and iframes are blocked; call the outside world from the backend with `fetch` or `ctx.web` and pass the result to the page. Cookies and WebSocket are unavailable; use the backend and `events.subscribe` instead. Bundle fonts and images as local files.
- Binary data crosses the page and backend boundary only as `ArrayBuffer`, `Uint8Array` or a Blob read to bytes. `FormData`, streamed uploads and `File` bodies do not arrive.
- The backend has no child processes, no listening ports, no access to this computer's local network or services, and may write only inside `ctx.dataDir`. For work beyond that, use `ctx.agent.run`.
- Never write secrets or keys into the source. When an app needs a third-party API key, store what the user types in `ctx.kv`, and say plainly that it is stored on this computer.
