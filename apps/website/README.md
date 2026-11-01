# Atd website

The marketing site for Atd: a static site built with Vite and React 19, prerendered once per language, with a
WebGL2 dot-matrix hero. English is served at `/` and Simplified Chinese at `/zh`. Support download
pages live at `/debug` and `/zh/debug`.

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
   `dist/zh/index.html`, plus both diagnostic routes, then `sitemap.xml` (only indexable pages,
   with their hreflang alternates) and
   `robots.txt`, and deletes `dist-ssr`.

The pages are complete before any JavaScript runs; the browser hydrates them, and the WebGL hero, the
interactive demos and the interface showcase's timeline only enhance what is already there. Canonical and Open Graph URLs
use `SITE_URL` when set, otherwise the Vercel production domain (`VERCEL_PROJECT_PRODUCTION_URL`).

## Layout

```text
src/
  app.tsx              Page composition (nav, sections in order, footer)
  entry-client.tsx     Hydration (or a fresh render on the dev server)
  entry-server.tsx     Prerender entry: markup, head and html attributes per language
  head.ts              Title, description, robots, canonical, hreflang, Open Graph and X card tags
  structured-data.ts   The schema.org graph (site, author, page, app), built from content/site.ts
  i18n/                Languages, routes and the `useCopy` hook; each section keeps its own copy.ts
  styles/              apple-kit.css (generated), tokens.css, base.css, motion.css (entrance effects)
  ui/                  Shared section frame (a plate), dot-matrix glyphs, keycap
  lib/                 In-view, reduced-motion and hydration hooks, press feedback
  motion/              The reveal controller, text effects (decode, type) and the grid halo
  gl/                  The WebGL2 dot-matrix field: power-on, word changes, loupe, ripples, scroll dive
  sections/<name>/     One folder per section: index.tsx, CSS, copy.ts
  content/             Site facts (links, version), the interface scenes and archived captures
public/
  cases/               Case clips, earlier interface images, archived recordings (cases/README.md)
  brand/               The Atd mark, resized from packages/ui/src/assets/brands/atd
```

## Section layout

Section headings and introductions share the page's center line, with no category label beside them.
The features plate is one LED display set into the plate, a channel per capability (models,
computer use, extensions, memory, permissions and running locally). Each channel is 21 × 15 dots and lights its
capability's 11 × 11 pictogram (`src/sections/features/glyphs.ts`) on the shared LED board
(`src/ui/led-board.tsx`), which also draws the download board: the dots power on column by column
as the plate arrives, and a fine pointer swells them like a loupe. Strips keep each channel near
12rem wide, so the display stays compact. Wide (from 1100px), the six channels join into one strip
with hairline seams and their names and lines are centered beneath them; regular (700–1099px),
they form two strips of three; compact, each channel is a small square display (64–88px), cropped to the pictogram and one ring of dots, beside its name and line.
Each capability's description has two short lines authored in `copy.ts`; preserve their newline
so the descriptions align in both languages, while allowing enlarged text to reflow.
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

The interface showcase comes right after the hero; the nav calls it “Features”, and the features
display after it “Control”. The showcase plays ten short clips as a timeline, in three groups: in
place (the selection toolbar with a command's options, the compose card and the screenshot tool), panel
and conversation (main panel, conversation and Mini Panel), and apps and connections (computer use,
Apps, automations and settings). The clips are rendered by the films repository with the same
Remotion stack and product kit as the tour films: nine are spans of the tour films and one, settings,
is a short film of its own, each silent, at 1280 × 720, in English and in Chinese, so each language
shows the product in its own words. Each clip shows its case's whole process, pointer, keys and
answer included, then fades to black and loops. Their provenance and how to update them are in
[`public/cases/README.md`](public/cases/README.md).

Wide, the section's heading and lede are followed by two columns. The left column is a numbered
index of the ten steps, one per clip, scrolling normally along an LED rail at the displays' 8 px
pitch; each group opens with its name. On the right a stage holds still at the viewport's middle
(`position: sticky`): a frameless 16:9 screen that casts the current clip's light onto the plate
around it (four blurred lights, each its quarter's average color, read from the playing clip and
easing to each new case's colors: `glow.tsx`), a slate above naming the current group and surface and counting the cases (`05 / 10`),
and the case's caption below it like a subtitle under a picture, the lead-in dimmer than the part
it leads to. The step whose middle is nearest the screen's middle is current
(`use-case-timeline.ts`): its light on the rail turns on, its title brightens and its line rises
in, while the other steps keep only their number and a quiet title. The rail is lit from the first
step's light down to that reading line, 1:1 with the scroll. Nothing pins the page and nothing
snaps: the text moves with the scroll, and the stage changes clip as each step reaches it.
Narrower than 760 px, the stage and rail are left out and the steps stack, each with its own clip
above its number, title and line, and every line shows.

Clips play on their own clock, not the scroll's. Once the steps are a quarter of the way up the
viewport, the current clip plays from its start each time it becomes current, looping, however fast
the scroll moves on (`src/sections/cases/clip.tsx`); the others pause. A clip shows its poster, a
still of its result, until its video is actually playing, so a slow network or a refused autoplay
leaves the still in place. The prerendered page (no `data-timeline`) shows every step's line and the
first clip's poster, and reduced motion shows each clip's poster without playing it. A clip's video
loads only as it is about to play: on the stage the current one and up to two past it once the steps
come into view, stacked only the current one; posters load lazily.

Each step's title is a button that brings its step to the screen's middle: a neighbouring step
glides there, a farther one jumps so the clips in between don't flash by. Each step also has its
own link, its case's id as the hash (`/#automations`, `/zh#settings`): a page opened on it lands
with that step at the reading line, and choosing a step puts its link in the address bar without
adding a history entry.
The showcase review (`2564:159138` desktop, `2564:159288` compact) composes the shared section
heading, `Website / Case step` instances (Layout=Wide with State Upcoming, Current or Passed; the
Group start property shows an exposed `Website / Case group` legend; Number, Title and Description
text properties) along the rail, and the display with a scene and `Website / Case readout` (Group,
Current and Total text properties). The compact review stacks each scene above a
`Website / Case step` (Layout=Stacked), with a `Website / Case group` above a group's first scene.
These reviews still show the earlier Figma scenes in a bezel display, not the clips on the stage.

Keep bilingual labels, titles, descriptions, captions, clip descriptions and group names in
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

The download section offers an explicit Apple silicon / Intel choice, and the nav's download key
jumps to it rather than guessing the visitor's architecture. Installers are published per
architecture, both for macOS 15 or later:
`https://downloads.atd.best/latest/Atd-arm64.dmg` (Apple silicon) and
`https://downloads.atd.best/latest/Atd-x64.dmg` (Intel). These permanent URLs track the newest
verified stable installer without rebuilding the website for each release, and save as
`Atd-<version>-<arch>.dmg`.
The release workflow mirrors GitHub's original bytes to the separate `atd-releases` R2 bucket;
the latest URL's cache expires within 60 seconds. The root README also keeps a GitHub alternative.
A quiet line under the keys offers the preview builds, `https://downloads.atd.best/rc/Atd-arm64.dmg`
and `https://downloads.atd.best/rc/Atd-x64.dmg`, only for an architecture whose candidate is newer
than `site.version`. Once the page runs it reads the channel's `rc.json` through the same-origin
`/downloads/rc.json` (a rewrite in `vercel.json`, a proxy on the dev and preview servers, since the
download host sends no CORS headers); the prerendered page, a failed read, and a channel that has
fallen back to the stable release or an older candidate all leave the line out.
See the [release mirror instructions](../../ops/release-downloads/README.md) for channels,
credentials, verification, and manual retries. Installed apps update from the same bucket's `appcast.xml` (Apple silicon) or
`appcast-x64.xml` (Intel).

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

## Diagnostic downloads

`/debug` (English) and `/zh/debug` (Chinese) are standalone support download pages. They preserve
language when switching, explain the reproduction/export steps, and link back to the regular
installer. They have `noindex, nofollow` metadata, are excluded from the sitemap, and do not add
a diagnostic download to the main navigation or regular download section.

The page loads `/downloads/debug.json`, proxied to
`https://downloads.atd.best/debug/manifest.json` by Vercel and the local Vite configuration.
Only a valid version-1 debug manifest enables download links. It must name a diagnostic version,
source revision, runtime/focus profile and architecture entries containing size, SHA-256,
minimum macOS and an immutable URL below `/debug/builds/<revision>/<version>/` on the download
host. A 404 shows that no package is available; failed or malformed reads offer Retry. No fallback
to regular or preview builds is made. JavaScript is required to load current availability.

The permanent `debug` branch owns package recording, signing, verification and the channel
publisher. This website change is maintained separately on a main-based branch: never merge
`debug` into `main`. Successful diagnostic builds update only their own channel, after both
installers and their dependencies pass delivery checks. This website ships no recorder and no logs.
