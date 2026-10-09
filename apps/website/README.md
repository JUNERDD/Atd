# Atd website

The marketing site for Atd: a static site built with Vite and React 19, prerendered once per language, with a
WebGL2 dot-matrix hero. English is served at `/` and Simplified Chinese at `/zh`.

The look is fixed dark and strictly monochrome, retro-modern and spare: the page is one instrument. The hero is
its main LED display, which spells out the name, Atd: anything, anytime, anywhere, to do. Below it come the
interfaces, the features and the download, then the footer. Each is a plate of the faceplate, perforated with
a 24 px dot grid registered to the plate, joined to the next by a seam with registration crosses. Each plate
carries one message: a centered heading lit in dots like the hero's word, a short lede, and one demo.

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
interactive demos and the interface showcase's scroll sequence only enhance what is already there. Canonical and Open Graph URLs
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
The features plate is one LED display set into the plate, a channel per capability (models,
extensions, memory, permissions and running locally). Each channel is 21 × 15 dots and lights its
capability's 11 × 11 pictogram (`src/sections/features/glyphs.ts`) on the shared LED board
(`src/ui/led-board.tsx`), which also draws the download board: the dots power on column by column
as the plate arrives, and a fine pointer swells them like a loupe. Wide (from 1100px), the five
channels join into one strip with hairline seams and their names and lines are centered beneath
them; regular (700–1099px), they form two strips, three over two; compact, each channel is a small
square display (64–88px), cropped to the pictogram and one ring of dots, beside its name and line.
The features review (`2564:159329` desktop, `2564:159355` compact) composes the shared section
heading with `Website / Feature channel` (Layout=Strip with Position Start, Middle, End;
Layout=Compact), whose Pictogram property swaps among `Website / Feature pictogram` (one variant
per capability).

## Header language menu

The header uses a 44 px Lucide language icon button and an end-aligned dropdown. Radix handles
keyboard navigation, dismissal, focus restoration and viewport collision. The English and 简体中文
links keep their language routes and remember explicit choices; the current language has a checkmark.
The button and menu states (`2495:144651`)
reuse the website's monochrome tokens and remain connected to the shared Lucide library.

## Interface showcase

The “Interfaces” section comes right after the hero. It shows eight Figma scenes as one scroll
sequence: the selection toolbar, Mini Panel, screenshot tool, main panel, conversation, settings,
Apps and automations. All scenes share the canonical desktop and a 1440 × 900 canvas, so the
showcase keeps one desktop still and changes only what is on it. Each scene is a stack of layers
cut from Figma (`scripts/matte-layers.py`) that reproduces the flat export at rest, and each plays
in the way the real surfaces arrive on a Mac (`src/sections/cases/scenes.css`): text is selected
before its toolbar appears, the Mini Panel slides out from the edge, a capture is framed and
annotated step by step, windows open and replies stream in. The layers are positioned by
`case-layers.css`, so the prerendered page shows the first scene complete; reduced motion keeps
them at rest and only cross-fades between scenes.

The stage pins to the viewport (`position: sticky`) while its track scrolls past. The track is one
stage tall plus one step of scrolling per scene, and `use-case-scroll.ts` turns how far it has
scrolled into the scene. The stage holds only the screen, the scene's caption and a row of eight
bars: the bars behind the current scene are full, and the current one fills 1:1 with the scroll.
Each bar is also a button that jumps straight to its scene; the jump is instant, so the pinned stage
doesn't move and the scenes in between never flash. As the stage rises into place the screen grows
to full size, tied to the scroll where the browser supports scroll-driven animations. The screen
takes the height the stage leaves it, and on landscape phones the caption and bars sit beside it.
The section's heading and lede open the stage (the showcase places them with `SectionHeader`), and
they pin with it when the viewport holds them beside a full-size screen, its caption and the bars;
otherwise the stage pins higher by the heading's height, so the heading scrolls away and fades
while the screen keeps its size (`use-case-scroll.ts` measures which). Whatever height is still
unused is shared above and below the pinned stage.
The showcase review (`2564:159138` desktop, `2564:159288` compact) composes the shared section
heading with a scene, `Website / Case caption` (Align: Center, Start) and `Website / Case progress`,
whose eight `Website / Case progress key` instances take a Progress (Next, Current, Done) and a
State (Rest, Hover, Focus).

The source nodes, layer exports, export process and image paths are in
[`public/cases/README.md`](public/cases/README.md). Keep bilingual labels and descriptions in
`src/content/cases.ts`, and the section's own copy in `src/sections/cases/copy.ts`.
The former standalone Automations section and its navigation link are no longer mounted;
automations appear as a scene in this showcase.

## Archived Privacy section

The homepage no longer mounts the Privacy section (`src/sections/privacy/`) or its navigation link;
its message lives on as the features display's “Runs locally” channel.
Its board, which showed what stays on the Mac and what leaves it with a cloud or a local model,
remains in the source, and its review (`2504:145342` desktop, `2504:145595` compact) remains in the
project design file with the components `Website / Privacy board`, `Website / Privacy line`,
`Website / Model switch` and `Website / Privacy promises`.

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

The Vercel project `atd-agent` is connected to `JUNERDD/Atd` with
`apps/website` as its Root Directory:

- A push to `main` deploys production; other branches and pull requests get preview deployments.
- Commits that change nothing in `apps/website` or its workspace dependencies are skipped (the project's
  "skip unaffected projects" setting).
- `vercel.json` sets the filtered install, the build, clean URLs without trailing slashes, long-lived
  caching for hashed assets, and security headers.
- Vercel checks the media manifest after building. With `VITE_ASSET_BASE_URL` configured, missing
  CDN objects or invalid delivery headers fail the deployment before it replaces the current site.
  Upload new media before pushing a website change; then run `assets:check` as shown below.
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
The independent [R2 budget guard](../../ops/r2-budget-guard/README.md) can pause the media and
download buckets' public endpoints when the shared account approaches its allowance.

### Installer downloads

Both download buttons use `https://downloads.atd.best/latest/Atd-arm64.dmg`. This permanent URL
tracks the newest verified stable installer without rebuilding the website for each release, and
saves as `Atd-<version>-arm64.dmg`.
The release workflow mirrors GitHub's original bytes to the separate `atd-releases` R2 bucket;
the latest URL's cache expires within 60 seconds. The root README also keeps a GitHub alternative.
See the [release mirror instructions](../../ops/release-downloads/README.md) for credentials,
verification, and manual retries. Application updates continue to use the signed GitHub appcast.

### Media rollback

Rollback: promote the previous known-good Vercel deployment using
`vercel rollback <previous-production-deployment-url> --scope "$VERCEL_SCOPE"`, setting
`VERCEL_SCOPE` to the deployment team's slug from your private project context. Keep historical
R2 keys so previous deployments continue to resolve their media. To restore entirely local delivery,
remove `VITE_ASSET_BASE_URL` from the relevant Vercel environment and rebuild/redeploy; locally use:

```sh
SITE_URL=https://atd.best VITE_ASSET_BASE_URL= pnpm --filter @atd/website build
pnpm --filter @atd/website assets:check
```

Build/public paths are implemented with Vite's supported plugin API, and uploads reuse
[Cloudflare Wrangler](https://developers.cloudflare.com/r2/objects/upload-objects/) rather than custom authentication.
