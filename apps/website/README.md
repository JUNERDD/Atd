# Atd website

The marketing site for Atd: a static site built with Vite and React 19, prerendered once per language, with a
WebGL2 dot-matrix hero. English is served at `/` and Simplified Chinese at `/zh`.

The look is fixed dark and strictly monochrome: Apple marketing-page structure (display type, one message per
section, one floating glass nav, pill buttons) on a functional dot-matrix grid (an 8 px unit and a visible
24 px dot grid, dot-matrix lettering, instrument labels). The hero is an LED panel whose display spells out the
name, Atd: anything, anytime, anywhere, to do. Sections arrive with entrance choreography as they scroll into
view, and the demos in them come alive.

## Commands

Run from the repository root:

| Command                                | Does                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| `pnpm --filter @atd/website dev`       | Dev server on <http://127.0.0.1:5180> (`/zh` for Chinese)           |
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
interactive demos and the video gallery only enhance what is already there. Canonical and Open Graph URLs
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
  ui/                  Shared section frame, split-text headings, dot-matrix glyphs, keycap
  lib/                 In-view, reduced-motion and hydration hooks, press, glass and spotlight feedback
  motion/              The reveal controller, text effects (decode, count, type) and the grid halo
  gl/                  The WebGL2 dot-matrix field: power-on, word changes, loupe, ripples, scroll dive
  sections/<name>/     One folder per section: index.tsx, CSS, copy.ts
  content/             Site facts (links, version) and the case recordings list
public/
  cases/               Case recordings and posters (see cases/README.md)
  brand/               The Atd mark, resized from packages/ui/src/assets/brands/atd
```

## Case recordings

The "In practice" section shows screen recordings of real tasks. Until a case has a recording it shows a
dot-matrix test card. To add one, follow [`public/cases/README.md`](public/cases/README.md): export the
clip and its poster, put them in `public/cases/` (or on Vercel Blob for large files), and set the case's
`video` in `src/content/cases.ts`.

## Hero words

The hero display shows the words in `heroCopy.words` (`src/sections/hero/copy.ts`) in turn, starting with
the name, each melting into the next (the field blends the two words' signed distance fields, so the
letters' edges flow from one shape to the other); `|` marks where a word may break onto two lines on
narrow screens. The display is drawn, so the words stay the same in both languages; the page's heading
(`heroCopy.title`) says what they mean in each. A button in the panel's corner pauses the display, which
starts paused for visitors who prefer reduced motion.

## Motion

Entrances use one attribute protocol, documented in `src/styles/motion.css` and `src/motion/reveal.ts`:
`data-reveal="<effect>"` marks an element that arrives with an effect (rise, fade, lift, left, right, plot,
draw, power, words, decode, count, type), and `data-reveal-group` makes a container's elements arrive
together, staggered. The page script marks them `data-revealed` as they scroll into view; `useRevealed`
starts a demo's own sequence from the same moment. Without script, in print and under reduced motion,
everything is simply shown.

## Design rules

- Tokens live in `src/styles/tokens.css`; components use them instead of literal values.
- The Apple web kit (`src/styles/apple-kit.css`) supplies the glass material, buttons, press and focus
  states, and motion tokens. It is generated, not edited; regenerate it with the apple-design skill:
  `python3 .agents/skills/apple-design/scripts/build_kit.py base type glass states button motion scroll-edge --css apps/website/src/styles/apple-kit.css`.
- Glass is only for floating controls (the nav, the gallery controls); content and tiles stay opaque.
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
