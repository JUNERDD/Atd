# Atd website

The marketing site for Atd: a static site built with Vite and React 19, prerendered once per language, with a
WebGL2 dot-matrix hero. English is served at `/` and Simplified Chinese at `/zh`.

The look is fixed dark and strictly monochrome, retro-modern and spare: the page is one instrument. The hero is
its main LED display, which spells out the name, Atd: anything, anytime, anywhere, to do. Below it, every
section is a plate of the faceplate, perforated with a 24 px dot grid registered to the plate, joined to the
next by a seam with registration crosses. Each plate carries one message: a centered heading lit in
dots like the hero's word, a short lede, and one demo on a smaller LED display set into the plate.

## Commands

Run from the repository root:

| Command                                | Does                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev:website`                     | Dev server on <http://127.0.0.1:5180> (`/zh` for Chinese)           |
| `pnpm preview:website`                 | Builds, then serves the built `dist` on <http://127.0.0.1:4180>     |
| `pnpm --filter @atd/website build`     | Client build, server build, then one prerendered page per language  |
| `pnpm --filter @atd/website preview`   | Serves the built `dist` on <http://127.0.0.1:4180>                  |
| `pnpm --filter @atd/website typecheck` | TypeScript                                                          |
| `pnpm --filter @atd/website lint`      | Oxlint, including the repository's 350-line and design-system rules |

`pnpm check` at the root covers the website along with every other package.

## How the build works

1. `vite build` bundles the client and turns `index.html` into the page template.
2. `vite build --ssr src/entry-server.tsx` builds a server bundle into `dist-ssr`.
3. `scripts/prerender.ts` renders the app for each language into the template (markup, head tags, the
   `<html lang>` attributes, a preload for the dot-matrix font) and writes `dist/index.html` and
   `dist/zh/index.html`, then deletes `dist-ssr`.

The pages are complete before any JavaScript runs; the browser hydrates them, and the WebGL hero, the
interactive demos and the interface carousel only enhance what is already there. Canonical and Open Graph URLs
use `SITE_URL` when set, otherwise the Vercel production domain (`VERCEL_PROJECT_PRODUCTION_URL`).

## Layout

```text
src/
  app.tsx              Page composition (nav, sections in order, footer)
  entry-client.tsx     Hydration (or a fresh render on the dev server)
  entry-server.tsx     Prerender entry: markup, head and html attributes per language
  head.ts              Title, description, canonical, hreflang and Open Graph tags
  i18n/                Languages, routes and the `useCopy` hook; each section keeps its own copy.ts
  styles/              apple-kit.css (generated), tokens.css, base.css, motion.css (entrance effects)
  ui/                  Shared section frame (a plate), dot-matrix glyphs, keycap
  lib/                 In-view, reduced-motion and hydration hooks, press feedback
  motion/              The reveal controller, text effects (decode, type) and the grid halo
  gl/                  The WebGL2 dot-matrix field: power-on, word changes, loupe, ripples, scroll dive
  sections/<name>/     One folder per section: index.tsx, CSS, copy.ts
  content/             Site facts (links, version), the interface scenes and archived captures
public/
  cases/               Interface images and archived recordings (see cases/README.md)
  brand/               The Atd mark, resized from packages/ui/src/assets/brands/atd
```

## Section layout

Section headings and introductions share the page's center line, with no category label beside them.
The privacy diagram is centered below its heading and capped at 54rem; its existing grid changes
direction at 1000px. The [desktop and compact layout review](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5?node-id=2504-145342)
keeps the shared heading and diagram components alongside the website's other design sources.

## Header language menu

The header uses a 44 px Lucide language icon button and an end-aligned dropdown. Radix handles
keyboard navigation, dismissal, focus restoration and viewport collision. The English and 简体中文
links keep their language routes and remember explicit choices; the current language has a checkmark.
The [button and menu states](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5?node-id=2495-144651)
reuse the website's monochrome tokens and remain connected to the shared Lucide library.

## Interface carousel

The “Interfaces” section shows eight exact Figma exports: the selection toolbar, Mini Panel,
screenshot tool, main panel, conversation, settings, Apps and automations. All scenes share the canonical desktop
background and a 1440 × 900 canvas. The website displays each complete image without cropping.

[Embla](https://www.embla-carousel.com/docs/v8/get-started/react) handles looping, dragging and
three-second automatic playback. Visitors can select a scene, go backward or forward, pause, resume,
or open the original image. Holding a scene with a mouse or touch temporarily pauses playback;
releasing it resumes automatic playback if it was enabled. Hovering leaves playback running.
Keyboard focus and manual navigation stop it until the visitor resumes; it also pauses offscreen and
in hidden tabs. Reduced motion starts paused and removes the slide animation.
The progress bar beside the playback controls follows Embla's timer, freezes while paused and
restarts with each slide. Its interval label uses the same three-second setting as playback.
Scene selectors use compact labels that wrap instead of scrolling sideways. Below 480 px, a
two-column layout keeps all eight choices visible and preserves a 44 px minimum touch target.
The [navigation component and responsive examples](https://www.figma.com/design/D9YK1tEeBTEBgstcepesW5?node-id=2488-144568)
are kept in the project design file alongside the website's existing color tokens.

The source nodes, export process and image paths are in
[`public/cases/README.md`](public/cases/README.md). Keep bilingual labels and descriptions in
`src/content/cases.ts`, and controls in `src/sections/cases/copy.ts`.
The former standalone Automations section and its navigation link are no longer mounted;
automations appear as a case in this carousel.

## Archived Summon demo

The homepage no longer mounts the Summon section or its shortcut demonstration. Its former native
captures remain in `public/summon/`, with source selection in `src/content/summon.ts`. They are not
loaded by the homepage. Background credit and capture provenance are preserved in
[`public/cases/README.md`](public/cases/README.md).

## Hero words

The hero display shows the words in `heroCopy.words` (`src/sections/hero/copy.ts`) in turn, starting with
the name, like a terminal: a block cursor of dots backspaces each word away and types the next, a
character at a time, then blinks while the word rests (`src/gl/typing.ts` sets the pace; the rasterizer
records which character each dot belongs to and where the cursor stands after each one). The name is
set as large as it fits; the words after it share one size, so typing among them stays on one line; `|` marks
where a word may break onto two lines on narrow screens. The display is drawn, so the words stay the
same in both languages; the page's heading (`heroCopy.title`) says what they mean in each. For visitors
who prefer reduced motion the display holds the name with a steady cursor.

## Motion

Entrances use one attribute protocol, documented in `src/styles/motion.css` and `src/motion/reveal.ts`:
`data-reveal="<effect>"` marks an element that arrives with an effect (rise, fade, plot, draw, power, light,
drop, wave, decode, type), and `data-reveal-group` makes a container's elements arrive
together, staggered. The page script marks them `data-revealed` as they scroll into view; `useRevealed`
starts a demo's own sequence from the same moment. Without script, in print and under reduced motion,
everything is simply shown.

## Design rules

- Tokens live in `src/styles/tokens.css`; components use them instead of literal values.
- The Apple web kit (`src/styles/apple-kit.css`) supplies the glass material, buttons, press and focus
  states, and motion tokens. It is generated, not edited; regenerate it with the apple-design skill:
  `python3 .agents/skills/apple-design/scripts/build_kit.py base type glass states button motion scroll-edge --css apps/website/src/styles/apple-kit.css`.
- Two materials, both in `src/styles/base.css`: the plate (`.plate`, perforations registered to the plate,
  so the container's edges and the seams run between dots) and the display (`.display`, black glass with
  finer LEDs). What a display shows is drawn in dots. The nav is a matte strip, not glass.
- Type has three roles: headings lit in dots (`.dot-text`), printed legends (`.legend`, small and sentence
  case) and readouts in Doto (`.readout`). Section headings and ledes share the page's center line;
  legends and readouts provide supporting detail within each demo.
- Keep each plate to one message and one demo; cut copy before adding more.
- Motion animates only `transform` and `opacity`, pauses off-screen, and falls back to fades or stillness
  under reduced motion. Every interaction has a keyboard path.
- The repository's Oxlint rules apply: no `style` props or `<style>` elements in JSX, static class names
  (state goes in `data-*` and `aria-*` attributes), and at most 350 lines per `.ts`/`.tsx` file.

## Deployment

The Vercel project `atd-agent` (team `junerdds-projects`) is connected to `JUNERDD/ai` with
`apps/website` as its Root Directory:

- A push to `main` deploys production; other branches and pull requests get preview deployments.
- Commits that change nothing in `apps/website` or its workspace dependencies are skipped (the project's
  "skip unaffected projects" setting).
- `vercel.json` sets the filtered install, the build, clean URLs without trailing slashes, long-lived
  caching for hashed assets, and security headers.
- The project variable `ENABLE_EXPERIMENTAL_COREPACK=1` makes Vercel use the repository's pinned pnpm
  (`packageManager` in the root `package.json`); the project runs Node.js 24.

### Domain and media delivery

The production origin is `https://atd.best`; `www.atd.best` redirects to the apex through Vercel.
Cloudflare remains authoritative DNS. Set Vercel build variables `SITE_URL=https://atd.best` and
`VITE_ASSET_BASE_URL=https://assets.atd.best`. The latter is public configuration, never a credential.
The dedicated R2 bucket is `atd-assets`, exposed through its custom domain `assets.atd.best`.

Only raster images and videos under `public/cases/` and `public/summon/` enter the media pipeline.
Their keys are `assets/media/<source-name>-<first-16-SHA256-characters>.<extension>`.
The client and prerender server share the same generated URLs. Without an asset base, builds serve
those hashed files locally; development uses the original public files. JavaScript, CSS, fonts,
brand images, icons and the Open Graph image stay on Vercel. Original media copies are omitted from
the built site, while the hashed media remain available for upload and local rollback builds.

`dist/asset-manifest.json` records every media key, byte count, full SHA-256, MIME type and
`public, max-age=31536000, immutable` policy. Authenticate using Wrangler's supported login or
Cloudflare environment variables; do not store credentials in `VITE_*` or commit local auth files.
Run these commands from the repository root, uploading and verifying before deploying a CDN build:

```sh
SITE_URL=https://atd.best VITE_ASSET_BASE_URL=https://assets.atd.best pnpm --filter @atd/website build
pnpm --filter @atd/website assets:upload --bucket atd-assets --dry-run
pnpm --filter @atd/website assets:upload --bucket atd-assets
pnpm --filter @atd/website assets:check --base https://assets.atd.best --origin https://atd.best --full
```

Uploads validate local bytes and hashes before invoking the pinned Wrangler CLI and never delete
objects. Delivery checks verify local hashes, remote size, MIME type, CORS, immutable caching and
byte-preserving video ranges; `--full` also compares every downloaded SHA-256. Configure bucket CORS
for GET and HEAD from `https://atd.best` (and any explicitly supported preview origins), allowing
Range and exposing Content-Length, Content-Range, Accept-Ranges and Cache-Control.
The checked-in `r2-cors.json` allows GET/HEAD from any origin because these are public media;
this also supports preview deployments. Apply it with
`pnpm --filter @atd/website exec wrangler r2 bucket cors set atd-assets --file r2-cors.json`.
The independent [R2 budget guard](../../ops/r2-budget-guard/README.md) can pause this bucket's
public endpoints when the shared account approaches its allowance.

Rollback: promote the previous known-good Vercel deployment using
`vercel rollback <previous-production-deployment-url> --scope junerdds-projects`. Keep historical
R2 keys so previous deployments continue to resolve their media. To restore entirely local delivery,
remove `VITE_ASSET_BASE_URL` from the relevant Vercel environment and rebuild/redeploy; locally use:

```sh
SITE_URL=https://atd.best VITE_ASSET_BASE_URL= pnpm --filter @atd/website build
pnpm --filter @atd/website assets:check
```

Build/public paths are implemented with Vite's supported plugin API, and uploads reuse
[Cloudflare Wrangler](https://developers.cloudflare.com/r2/objects/upload-objects/) rather than custom authentication.
