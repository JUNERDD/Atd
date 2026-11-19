# Atd website

The marketing site for Atd: a static site built with Vite and React 19, prerendered once per language, with a
WebGL2 dot-matrix hero. English is served at `/` and Simplified Chinese at `/zh`. The blog lives at
`/blog` and `/zh/blog`, one page per post, edited with a Git-based CMS ([Blog](#blog)). Capability
pages live at `/features` and `/features/<slug>`, and questions at `/faq`, in both languages
([Capability pages, FAQ and search](#capability-pages-faq-and-search)). Support download pages live
at `/debug` and `/zh/debug`.

The look is strictly monochrome, retro-modern and spare, following the system's light or dark appearance
with a persistent override in the footer. The page is one instrument: the hero pairs its main LED display
with a rotating 3D ASCII sculpture and spells out the name, Atd: anything, anytime, anywhere, to do.
Below it come the interfaces, the features and the download, then the footer. Each section is a plain plate
of the faceplate, sized on a 24 px grid and joined to the next by a seam with registration crosses. Each plate
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
   `dist/zh/index.html`, plus the capability hub and pages, the FAQ, the blog's list and posts, both
   diagnostic routes, and `dist/404.html`. Using `scripts/seo-outputs.ts`, it also writes
   `sitemap.xml` (only indexable pages, each with `<lastmod>`, `hreflang` alternates and, for posts,
   their images), bilingual RSS 2.0 feeds (`feed.xml` and `zh/feed.xml`) and `robots.txt`; using
   `scripts/llms-outputs.ts`, dynamic `llms.txt` / `llms-full.txt`. It then deletes `dist-ssr`.

The pages are complete before any JavaScript runs; the browser hydrates them, and the WebGL hero, the
interactive demos and the interface showcase's timeline only enhance what is already there. Canonical and Open Graph URLs
use `SITE_URL` when set, otherwise the Vercel production domain (`VERCEL_PROJECT_PRODUCTION_URL`).

## Layout

```text
src/
  app.tsx              Page composition (nav, the page's main content, footer)
  entry-client.tsx     Hydration (or a fresh render on the dev server)
  entry-server.tsx     Prerender entry: routes, markup, head and html attributes per language
  head.ts              Renders the head tags: title, description, robots, canonical, hreflang, RSS,
                       Open Graph (and article tags for posts), X cards and the structured data
  seo/page-head.ts     Each page's head facts: copy, visibility, share image and schema.org graph
  structured-data.ts   Shared schema.org nodes (site, author, breadcrumbs) and the home page's app
  seo/*-structured-data.ts  The blog, capability-page and FAQ graphs
  i18n/                Languages, routes and the `useCopy` hook; each section keeps its own copy.ts
  styles/              apple-kit.css (generated), tokens.css, base.css, motion.css (entrance effects)
  ui/                  Shared section frame (a plate), dot-matrix glyphs, keycap, question items
  lib/                 In-view, active-section, reduced-motion and hydration hooks, press feedback
  motion/              The reveal controller and text effects (decode, type)
  gl/                  The WebGL2 dot-matrix field: power-on, word changes, loupe, ripples
  sections/<name>/     One folder per section: index.tsx, CSS, copy.ts
  pages/<name>/        Other routes: capability hub and pages (`features/`), FAQ, blog, diagnostic
                       downloads (`/debug`), and 404 fallback
  content/             Site facts (links, version), the interface scenes and archived captures
  content/features/    One module per capability page, the hub's copy, and their types
  content/faq/         The FAQ's page copy and one module per question group
  content/blog/        The blog's posts, one YAML file per language and release (the CMS's)
public/
  cases/               Case clips, earlier interface images, archived recordings (cases/README.md)
  brand/               The Atd mark, resized from packages/ui/src/assets/brands/atd
  media/blog/          Each post's images, one folder per release, served by Vercel
  site.webmanifest     Web app manifest (name, colors, icons)
admin/                 The blog's CMS (Sveltia CMS), served only by the dev server
blog-content.ts        Validates the blog at build time and serves it as virtual:atd-blog
```

## Section layout

Section headings and introductions share the page's center line, with no category label beside them.
The shared content column grows to 1680 px on wide screens, on the 24 px grid; the interface
showcase, feature display, download section and footer follow the same edges. The download wide
review is `4259:15568`, and the footer wide review is `4259:16030`. Blog posts retain their
1200 px reading layout within the wider site.
Every page with a footer (all but the diagnostic downloads) ends on the app panel's flowing light
(`src/sections/footer/footer-glow.tsx`): the panel's drifting light field rising from the bottom
edge behind the footer, monochrome and seen only through the plate's LED holes (white dots in dark
mode, black in light mode), over a floor of 120 px under the small print. The dots stay dim: the
light peaks at the hero backdrop's brightness (`--glow-level`, which follows
`--ascii-foreground-mix`), so the page closes on the material it opens with. The light powers on as
the hero's display does rather than with the panel's bloom: once a quarter of the band is in view,
it comes up from the bottom edge patch by patch, each patch catching a little bright as it lights,
over about a second and a half; then it flows at 30 frames a second, and stops while it is off
screen or the tab is hidden. Reduced motion shows it still, Increase Contrast at half its level,
and forced colors and print not at all. Its runner loads only near the footer and draws a
WebGL2 buffer of one texel per 16 CSS px (a few kilobytes); the dots are a static perforated sheet
over it, so a frame costs a draw of one or two thousand texels and no repaint. In the design file,
`Website / Site footer` carries the floor and an `Afterglow` band whose masks are a still frame of
the shader, lit in `dot/lit` at `glow/level`, with `glow/veil` of that light between the holes; the
wide review `4259:16030` and `Footer · Afterglow · Review` (`4388:22220`) show it.
The features plate is one LED display set into the plate, a channel per capability (models,
computer use, extensions, memory, permissions and running locally). Each channel is 21 × 15 dots and lights its
capability's 11 × 11 pictogram (`src/sections/features/glyphs.ts`) on the shared LED board
(`src/ui/led-board.tsx`), which also draws the download board: the dots power on column by column
as the plate arrives, and a fine pointer swells them like a loupe. Strips use equal-width channels.
Wide (from 1100px), the six channels fill the content column in one strip
with hairline seams and their names and lines are centered beneath them; regular (700–1099px),
they form two strips of three; compact, each channel is a small square display (64–88px), cropped to the pictogram and one ring of dots, beside its name and line.
Each capability's description has two short lines authored in `copy.ts`; preserve their newline
so the descriptions align in both languages, while allowing enlarged text to reflow.
The features reviews (`2564:159329` desktop, `4259:13637` wide, `2564:159355` compact) compose the shared section
heading with `Website / Feature channel` (Layout=Strip with Position Start, Middle, End;
Layout=Compact), whose Pictogram property swaps among `Website / Feature pictogram` (one variant
per capability).

## Blog

`/blog` (and `/zh/blog`) lists every post, newest first, as opaque cards (the kit's `card` block,
filled `--ink-2`, never glass): each card is one link showing the post's first image, its release
as a dot-matrix readout, the date, the title and the summary, with a hover fill under a mouse and
no pressed state when clicked. The newest post spans the row and, from
900px, sets its image beside the text; the rest fill as many 340px columns as fit. Each post is its
own page at `/blog/atd-<version with dashes>` (`/blog/atd-0-10-6`; no dots, so Vercel's `cleanUrls`
never reads one as a file extension): a back button, a centered header (release, title, summary,
date), then the contents and the sections. The contents are the sections' titles as plain links on
one track, with the section under the reading line lit (`aria-current="location"`); below 1100px
they sit under the header, from 1100px in a column of their own that stays beside the sections, and
the header aligns with the sections. Each highlight's text and image fill the main column; any
non-empty tail sections (`improvements`, `fixes`, `other`) follow in that order, each in a
full-width card whose items may carry an image, and the page ends with one primary action, the
release's installers on GitHub. A highlight's anchor is its English title in lowercase with dashes
(`#choose-your-panel-background`), the same in both languages; the tail sections use
`#improvements`, `#fixes`, and `#other`.

The nav links to the blog after the home page's sections, marking it current on the list and on
posts; the footer's links and language switch keep the visitor on the page they are reading. From
another page the nav's section links and download key lead back to the home page's sections. A
post's head tags make it an article (`og:type`, `article:published_time`) whose share image is its
first highlight's.

The desktop app's release-note links open the article for its installed stable version, in the
app's language. A stable release therefore requires both articles to be deployed before its
installer or update feeds are published. Verify that `/blog/atd-<version with dashes>` and
`/zh/blog/atd-<version with dashes>` each return HTTP 200 and show the intended version, and
preserve these URLs after publication. A release candidate has no article; the app does not
offer a version-specific release-note link for it.

### Content

The releases are files in this repository, edited with [Sveltia CMS](https://sveltiacms.app), a
Git-based CMS that writes them in place. Each post announces one release and has one YAML file per language
under `src/content/blog/<lang>/`, with the same file name in both:

| Field          | In each language | Holds                                                                                    |
| -------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `version`      | The same         | The released version without a leading `v`, such as `0.10.6`                             |
| `date`         | The same         | The release day, `YYYY-MM-DD`                                                            |
| `title`        | Translated       | The release's headline                                                                   |
| `summary`      | Translated       | One or two sentences under it                                                            |
| `highlights`   | Translated       | `title`, `body` (paragraphs and `- ` / `1. ` lists with inline Markdown), `image`, `alt` |
| `improvements` | Translated       | `text` (one inline Markdown paragraph), and optionally `image` with its `alt`; optional  |
| `fixes`        | Translated       | `text` (one inline Markdown paragraph), and optionally `image` with its `alt`; optional  |
| `other`        | Translated       | `text` (one inline Markdown paragraph), and optionally `image` with its `alt`; optional  |

`highlights[].body` and the tail note fields (`improvements[].text`, `fixes[].text`,
`other[].text`) accept a constrained editorial Markdown subset parsed at build time
(`blog-markdown.ts`): inline `**bold**`, `*italic*`, `` `code` ``, and `[link](url)` (`https://`,
`http://`, `/`, or `#`), plus flat `- ` bulleted and `1. ` numbered lists in `highlights[].body`.
Headings, raw HTML, fenced code blocks, tables, blockquotes, images, task checkboxes, nested
sublists, and unsafe link schemes fail the build; plain-text posts such as `0.10.6` and `0.10.7`
remain valid without edits.

`blog-content.ts` reads them at build time (the client and server builds alike) and fails the
build, naming the file, when a file does not match `src/content/blog-schema.ts`, uses unsupported
Markdown, lacks a language or disagrees on its version, date or item counts across `highlights`,
`improvements`, `fixes`, and `other`, repeats a version, collides on an English highlight anchor
(including `#improvements`, `#fixes`, and `#other`), has a note image without its description (or
the reverse), or references a missing image. It reads
each image's size so the page reserves its box, formats the dates once so prerendered and hydrated
pages agree, and serves the result as `virtual:atd-blog`; neither the validator nor the Markdown
parser reaches the browser. On the dev server, edits reload the page.

Images live in `public/media/blog/<release file name>/`, one per highlight and language, named
`<highlight>.<lang>.webp`. A fix or a small improvement may carry one too, wherever seeing the
change explains it better than the line alone; new features are not the only ones with images.
They are served by Vercel, outside the R2 media pipeline, so a blog edit deploys without an
upload. The 0.10.6 images are 1440 × 900 scenes of the real product UI with hand-drawn notes,
designed in the project design file's `W · Website · Blog · 0.10.6 images` section
(`3663:212419`), English and Chinese side by side, and exported at 1x as WebP (quality 85, the same
setting the CMS applies to uploads).

The 0.10.7 images are in `project/3771:216085`, in the
`W · Website · Blog · 0.10.7 images (2026-11-05)` section. The three scenes explain capture
hints, reading earlier replies, and stopping suggestion preparation, with Chinese and English
editions side by side. They retain the Tahoe Beach Dusk backdrop and use editable product
components with handwritten notes. Export each 1440 × 900 frame at 1x, then encode WebP at
quality 85; keep the localized alt text aligned with the scene.

The 0.11.0 images are in `project/4171:512653`, in the
`W · Website · Blog · 0.11.0 images (2026-11-12)` section (`4171:512654`–`4171:512661`). The four
scenes cover screen recording review and questions, scrolling long screenshots, running commands on
screenshot text, and Markdown in floating result cards, with Chinese and English editions side by
side over Nathan Anderson's _Red sunset on a mountain_ backdrop
([Wikimedia Commons](<https://commons.wikimedia.org/wiki/File:Red_sunset_on_a_mountain_(Unsplash).jpg>),
CC0 1.0 Public Domain) and handwritten notes, exported at 1440 × 900 (1x) as WebP at quality 85.

The 0.11.1 images are in `project/4211:519456`, in the
`W · Website · Blog · 0.11.1 images (2026-11-14)` section (`4211:519457`, `4211:519719`). The scene
covers model credential recovery after certificate updates, with Chinese and English editions side by
side over the same dusk mountain ridge backdrop and handwritten notes, exported at 1440 × 900 (1x) as
WebP at quality 85.

The 0.12.0 images are in `project/4395:320965`, in the
`W · Website · Blog · 0.12.0 images (2026-11-19)` section (`4395:320966`–`4395:320971`). The three
scenes show the alias list and composer switcher, the same annotated selection before and after
pinning, and the support bundle preview open inside Diagnostics. The settings,
switcher and preview layouts follow the production React components rendered with sample data in
each language. Windows, popovers, dialogs and toolbars use one translucent dark fill over a
blurred backdrop. The capture and the pin share a crop of the same frozen desktop, including
the wallpaper visible through the alias window.
Its toolbars use artwork rendered from the AppKit controls at 3×, placed at their native sizes.
The Chinese and English editions use Vincent Guth's _Iceland lake Northern Lights_ backdrop
([Wikimedia Commons](<https://commons.wikimedia.org/wiki/File:Iceland_lake_Northern_Lights_(Unsplash).jpg>),
CC0 1.0 Public Domain) and handwritten notes, exported at 1440 × 900 (1x) as WebP at quality 85.

### Design

The pages are designed in the project design file's `Website / Blog · Review · code-backed`
section (`3685:8952`, on the Website page): the list and a post, each at Desktop (English, 1280)
and Compact (Chinese, 320). They are built from `Website / Site nav` (including
`Website / GitHub button`, backed by `Brand / GitHub`), `Website / Site footer`,
`Website / Blog card` (Featured and Standard, with hover and focus), `Website / Post contents` and
its `Website / Post contents link` (default, current and hover, for pointer and touch),
`Website / Post fix` (an optional image), `Website / Plain button` and `Website / Download key`
(an optional trailing arrow). Font sizes that the CSS scales with the viewport come from the
`Website · Type scale` collection, whose Desktop and Compact modes hold the sizes at 1280 and 320.

### Editing with the CMS

1. Run `pnpm dev:website` and open <http://127.0.0.1:5180/admin/> in a Chromium browser (the
   CMS's local mode needs the File System Access API).
2. Choose **Work with Local Repository** and select the repository root. The CMS reads and writes the
   files above in your working tree and never contacts GitHub, so no sign-in is needed.
3. Add or edit a post in both languages, then review the diff and commit it on a branch for a pull
   request, as for any change. `main` accepts only merged pull requests, so the CMS's GitHub sign-in
   options, which would commit straight to it, are not used.

`admin/` holds the CMS's page and its configuration (`config.yml`). Only the dev server serves it:
the build's only input is the site's `index.html`, so the CMS never ships. The page loads one
pinned version of the CMS from unpkg; to update it, change the version in `admin/index.html`, open
the admin page and check that it still loads the posts. Keep `admin/config.yml` and
`src/content/blog-schema.ts` in step when the fields change.

The pages' own copy (heading, lede, labels and head tags) is in `src/pages/blog/copy.ts`.

`vite preview` serves each prerendered page at its clean URL, as Vercel does (the
`atd-preview-clean-urls` plugin in `vite.config.ts`), so `/blog/atd-0-10-6` previews the post rather
than the home page's HTML.

## Capability pages, FAQ and search

`/features` (and `/zh/features`) is the capability hub: its heading and lede, then one card per
capability linking to its page. `/features/<slug>` is one capability's page, read like a post: a
back button to the hub, a centered header (the capability's name as a readout, the `h1`, a lede, the
download key and the source link), its illustration, then contents beside
the sections, the capability's questions (always expanded), related capabilities, the release notes
that introduced or changed it, and a closing download key. `/faq` groups its questions under
headings, each answer optionally followed by a link to the capability page that covers it. These
pages reuse the blog's layout and card classes (`pages/blog/blog.css`) with their own
`features.css`, `faq.css` and the shared `ui/qa.css`. An illustration composes the showcase's
backdrop with a transparent foreground: the showcase case that depicts the capability, or a scene
of its own made the same way and kept off the homepage timeline (`public/cases/features/<lang>/`,
see [`public/cases/README.md`](public/cases/README.md)). Every footer carries a directory linking the hub, each
capability, the FAQ, the blog, and the repository and its releases, so each page links them all.

### Content

`src/content/features/types.ts` and `src/content/faq/types.ts` define the content. A capability
module holds both languages' name, card summary, head title (within about 60 characters in English
and 30 in Chinese, ending in `— Atd`), head description (about 120–155 characters in English, at
most 80 in Chinese), `h1`, lede, sections, questions and keywords, plus its `illustration` (a
showcase case, or its own scene with a description in each language), the pages it relates to, the posts that introduced or changed it, and `updated`, the day
of its last substantive edit. FAQ questions and answers are written per field, so both languages
always list the same questions.

- A slug is the page's URL in both languages; keep it once published. To add a capability, add its
  slug to `FEATURE_SLUGS` and its module to `featurePages` in the same order (the hub's); the build
  fails when the two lists differ.
- Describe what the released version (`site.version`) does, checked against its tag, and never
  compare with other products. Bump `updated` with every substantive edit.
- Section ids must not be `questions`, `related` or `release-notes`, which the page uses itself.
- The modules are plain TypeScript that the prerender scripts load under Node: keep `.ts` import
  extensions, and import `content/cases.ts` for its types only.

### Design

The pages are designed in the project design file's `Website / Features & FAQ · Review · code-backed`
section (`4378:16466`, on the Website page): the hub (`4380:16499` Desktop, English;
`4381:335349` Compact, Chinese), the computer use page (`4382:18910`, `4383:19588`) and the FAQ
(`4383:20861`, `4383:21088`), with `Example · Release notes (Screen capture)` (`4383:21324`). They
compose the blog's components with `Website / Blog card` (layouts Capability and Text),
`Website / Case frame` (the shared backdrop under a swappable foreground),
`Website / QA item`, `Website / Post list item` and `Website / Release note link`.
`Website / Site footer` carries the directory in both layouts, built from `Website / Footer link`
(Input Touch or Pointer, with an External arrow).

### Search outputs

`seo/page-head.ts` decides each page's head facts and `head.ts` renders them. A page is indexed,
unlisted (the diagnostic downloads: `noindex`, outside the sitemap) or missing (the 404 page, and on
the dev server an unknown capability slug). Every page carries the `WebSite` and `Person` nodes; the
home page adds its `WebPage` and the `SoftwareApplication` (`#app`), which other pages name in
`about`. The blog list is a `Blog`, a post a `BlogPosting` with breadcrumbs and article tags
(published and modified time, author, section and one tag per keyword), the hub a `CollectionPage`
with an `ItemList` of the capabilities, a capability page a `WebPage` with breadcrumbs and an
`FAQPage` of its questions, and `/faq` an `FAQPage` with breadcrumbs.

The sitemap's `lastmod` is a post's date for posts, `updated` for a capability page and the FAQ, the
latest `updated` for the hub, and the newest post's date for the other pages; posts list their
images. `robots.txt` allows everything except `/api/` and `/downloads/`. `llms.txt` indexes every
page; `llms-full.txt` holds the capabilities, the FAQ and every release in English.
`public/llms.txt` is the static copy the build replaces; keep its page list in step.

## Header language menu and GitHub entry

The header end cluster places a 44 px Lucide language icon button, a bordered GitHub Star link, and
the primary white download key side by side. Radix handles keyboard navigation, dismissal, focus
restoration and viewport collision for the end-aligned language dropdown; the English and 简体中文
links keep their language routes and remember explicit choices, with a checkmark on the current
language. The language button and menu states (`2495:144651`) reuse the website's monochrome tokens
and remain connected to the shared Lucide library.

The GitHub entry (`src/sections/nav/github-mark.tsx`, canonical `Brand / GitHub` from
`logos.lndev.me`) links to the repository in a new tab using a secondary bordered key beside
`Download` (`Website / GitHub button`): `44 × 44 px` icon-only below `416 px`, `Star` from `416 px`,
and `Star | <count>` from `480 px` upward, with explicit screen-reader context (`Star Atd on
GitHub (<count>)` / `在 GitHub 为 Atd 点亮 Star（<count>）`). Build prerendering (`scripts/prerender.ts`)
embeds the initial snapshot via `<meta name="atd:stars">` (falling back to `GITHUB_STARS_FALLBACK`
offline) so first paint never shifts, and the Vercel Function at `api/github.ts` (mirrored on Vite
dev and preview servers at `/api/github`) revalidates the live count through the Vercel CDN cache
(`s-maxage=1800, stale-while-revalidate=86400`).

## Interface showcase

The showcase presents ten static product illustrations in three groups: in place (selection,
review and screenshot), panel and conversation (main panel, conversation and Mini Panel), and
apps and connections (computer use, Apps, automations and settings). Each scene is designed with
editable, connected product components in the canonical Figma Website page, then exported as a
1440 × 900 transparent WebP in English and Chinese. Product compositions have safe margins over
one shared backdrop; Mini Panel anchors to the right, while the other scenes stay centered.
The source nodes, backdrop credit and export settings are
in [`public/cases/README.md`](public/cases/README.md). The homepage loads images only; earlier film
clips remain archived source material.

On wide screens, the grid-aligned showcase container grows to 1680 px, with a numbered index
beside a sticky 16:10 image that also stays within the viewport's available height. The step nearest the
image's middle becomes current (`use-case-timeline.ts`); its title brightens, its description
types in **without a caret**, and its foreground image and caption appear. An interrupted description
keeps its typed prefix while fading out and restarts from the complete source when selected again.
Captions fade out for 150ms before the latest caption fades in for 250ms; pending entrances are
cancelled on another selection so sentences never overlap. The backdrop remains
stationary outside the slide transitions. The LED rail follows the reading
line. Nearby images load lazily, and reduced motion keeps the same static artwork. On narrow
screens, each image sits above its own title and complete description. An image failure shows a
localized message. Each step retains its URL hash, such as `#screenshot`.

The desktop (`2564:159138`, 1280 px), wide (`4252:13350`, 1920 px), and compact
(`2564:159288`, 320 px) Figma reviews use instances of the new
`Showcase / <case> / <language>` compositions from `project/4227:9667`. Their case steps remain
connected to `Website / Case step`; the shared component documents the cursor-free reveal.
Bilingual labels, titles, descriptions, captions and image alt text live in `src/content/cases.ts`;
section-level copy lives in `src/sections/cases/copy.ts`.

The former standalone Automations section is no longer mounted; automations appear in this showcase.

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
  `python3 .agents/skills/apple-design/scripts/build_kit.py base type glass states button motion scroll-edge card --css apps/website/src/styles/apple-kit.css`.
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
- Vercel publishes the build's media, then checks them. `assets:publish` uploads the keys the
  `atd-assets` bucket lacks, with the R2 credentials described below, so a push that changes media
  needs no manual upload or redeploy. With `VITE_ASSET_BASE_URL` configured, `assets:check` then
  fails the deployment before it replaces the current site if a CDN object is missing or serves the
  wrong headers. A build without the credentials (a fork's preview, a local build) skips the upload
  and leaves the decision to the check.
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
`public, max-age=31536000, immutable` policy. Uploads go through the bucket's S3 API with an R2
API token scoped to `atd-assets` alone: in the Cloudflare dashboard, R2 → Manage API tokens →
Create Account API token, permission Object Read & Write, applied to `atd-assets` only. Store its
Access Key ID and Secret Access Key, with the account ID, as the sensitive variables
`R2_ASSETS_ACCESS_KEY_ID`, `R2_ASSETS_SECRET_ACCESS_KEY` and `R2_ASSETS_ACCOUNT_ID` in the Vercel
project's Production and Preview environments. Wrangler cannot use such a token: object-level
tokens work only with the S3 API, while Wrangler's object commands call the Cloudflare REST API,
which would need an account-wide Admin token. Never put credentials in `VITE_*` or commit them.
To publish by hand, export the same variables and run these from the repository root:

```sh
SITE_URL=https://atd.best VITE_ASSET_BASE_URL=https://assets.atd.best pnpm --filter @atd/website build
pnpm --filter @atd/website assets:upload --bucket atd-assets --dry-run
pnpm --filter @atd/website assets:upload --bucket atd-assets
pnpm --filter @atd/website assets:check --base https://assets.atd.best --origin https://atd.best --full
```

Uploads validate local bytes and hashes, ask the bucket which keys it already holds, upload only
the others and never delete objects; a held key whose size differs fails instead of being
overwritten. `--dry-run` lists what would be uploaded. Delivery checks verify local hashes, remote size, MIME type, CORS, immutable caching and
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

Build/public paths are implemented with Vite's supported plugin API. Uploads sign their S3
requests with [aws4fetch](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/), the
client Cloudflare documents for R2, rather than custom authentication; Wrangler still applies the
bucket's CORS.

## Diagnostic downloads

`/debug` (English) and `/zh/debug` (Chinese) are standalone support download pages. They preserve
language when switching, explain the reproduction/export steps, and link back to the regular
installer. They have `noindex, nofollow` metadata and `X-Robots-Tag` response headers, are excluded from the sitemap, and do not add
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
