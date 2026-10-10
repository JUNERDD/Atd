# Atd launch film

A 64-second product film for Atd, made with [Remotion](https://www.remotion.dev/): 1920 × 1080 at
60 fps, cut in English (`AtdPromo`) and Simplified Chinese (`AtdPromoZh`). It tells what the name
stands for. A shortcut opens it, and the three chapters show the agent at work, each through the
product's real interactions recreated in code:

- **Anywhere**: the selection toolbar in another app, capturing and marking up the screen, and the
  Mini Panel catching a dragged file.
- **Anything**: a task planned and worked end to end, an app built from a sentence and pinned to the
  desktop, and the commands, skills and automations the agent makes on request.
- **Anytime**: a night of automations while the Mac rests, and memory that keeps a correction.

The film then shows the models Atd runs on and its privacy promise, and closes on the same
shortcut.

## Commands

Run from the repository root:

| Command                                                   | Does                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm --filter @atd/promo-video studio`                   | Scores the soundtrack, then opens Remotion Studio                                                 |
| `pnpm --filter @atd/promo-video render`                   | Scores, bundles once and renders both cuts to `out/atd-promo-en.mp4` and `-zh.mp4`, with progress |
| `pnpm --filter @atd/promo-video render:en`                | Renders the English cut only (`render:zh` for Chinese)                                            |
| `pnpm --filter @atd/promo-video render:en --frames=0-299` | Renders only those frames (`N` or `A-B`, inclusive) to the same file, for a quick check           |
| `pnpm --filter @atd/promo-video soundtrack`               | Scores `public/audio/soundtrack.wav` and its stems from code                                      |
| `pnpm --filter @atd/promo-video typecheck`, `lint`        | TypeScript, and Oxlint with the repository's rules                                                |

`scripts/render.ts` labels each phase: scoring, bundling, then each cut. On a terminal, each phase
redraws one line with a bar, the frames rendered and encoded, the render speed, the elapsed time
and an ETA. In CI, a pipe or a log, it prints a plain line about every 5%, at most once every 2 s.

`out/` and `public/audio/` are generated and ignored by Git. The first render downloads the Chrome
Headless Shell that Remotion pins. Each cut is H.264 (CRF 15, tagged limited-range BT.709) with
320 kbps AAC, as `render-settings.ts` sets; both `scripts/render.ts` and `remotion.config.ts`
(Studio and the `remotion` CLI) read it.

## How it is built

**One clock.** `src/timeline.ts` places every section (`SECTIONS`) and every beat of their
choreography (`CHOREO`), on a 120 BPM grid: a bar every 2 s, so cuts fall on downbeats. The scenes
animate those moments and the soundtrack sounds them, so a click lands on the frame its button
presses. Change timing there, not in the scenes.

**Two kits.** `src/kit/world/` is the film's world. It has the light fields (the app's onboarding
palette, the only color in the film), the Mac's desktop (a 1512 × 982 pt display, scaled once),
windows, the cursor, a spring-driven 2.5D camera, macro keycaps, the Drops mark forming from two
drops of light, chapter titles and captions. `src/kit/product/` recreates Atd's own surfaces from
the app's sources: the task panel and its transcript, the selection capsule, capture and
annotation, the Mini Panel, notifications, the app builder and desktop pins. Its interface copy
comes from the app's locale files. The `WorldSheet` and `ProductSheet` compositions show every
component for review.

**Scenes.** `src/scenes/<section>/` composes the kits on the section's own clock. `src/scenes.ts`
lists them in film order. Each section is also a composition of its own in the Studio's Scenes
folder.

**Motion** uses closed-form springs (`src/motion/spring.ts`, response and damping ratio, as Apple's
frameworks describe them), so any frame can be computed on its own and velocities are exact. The
camera's motion blur follows them.

**The soundtrack** is synthesized by `scripts/soundtrack.ts` from the same timeline. The score
(`src/audio/score.ts`, `arrangement.ts`, `rhythm.ts`) is in D major: an airy open, a groove that
drops with each chapter, a filtered half-time night, a build and a full finale. Sound effects sit
on their cues (`cues*.ts`, `effects*.ts`), share one plate reverb, and the mix is mastered to
−15 LUFS with a −1 dBFS ceiling, measured the ITU-R BS.1770 way (`master.ts`). It uses no
recorded samples, so there is nothing to license. `public/audio/stems/` keeps music and effects
apart for editing.

**Copy.** The narrative (chapter words, captions, the call to action) lives in `src/copy.ts`, in
both languages. What appears inside the interface lives in each scene's `content.ts` and in the
product kit's `strings.ts`. `copy.ts` registers them all, so `fonts.ts` loads every glyph before
the first frame. The chapter words stay in English in both cuts, because they spell out the name.

## Styling

The repository's design-system lint applies here: no inline styles except CSS custom properties,
and no raw colors in TSX. Each component's stylesheet does the styling, and the timeline hands it
per-frame values as custom properties (`style={{ '--o': opacity }}`), often through the `Move`
component (`src/ui/Move.tsx`) and its `.move` class. `src/styles/film.css` holds the tokens and the
one Liquid Glass recipe every product surface uses. Remotion Studio can therefore play and scrub
the film but not drag its keyframes; edit `timeline.ts` and the scenes instead.

## Assets and licenses

- The Drops mark is drawn from `packages/ui/src/assets/brands/atd/symbol.svg`. Provider marks come
  from `packages/ui/src/assets/brands`, rendered as their `sources.json` says: in ink for
  foreground marks, in their own colors otherwise. They identify services Atd connects to and
  remain their owners' trademarks.
- Icons are Lucide (ISC). Fonts are Inter and Noto Sans SC from Fontsource, under the SIL Open
  Font License.
- Remotion is free for individuals and companies of up to three people; larger companies need a
  [company license](https://www.remotion.dev/license) to render.
