# Atd launch film

A 60-second launch film for Atd, made with [Remotion](https://www.remotion.dev/): 1920 × 1080 at
60 fps, cut in English (`AtdPromo`) and Simplified Chinese (`AtdPromoZh`). It opens on the website's
LED display, which lights the name and types what it stands for (anything, anytime, anywhere); the
display's cursor then opens into a Mac's screen for a tour of eight interfaces, and the film closes
on the features, the privacy promise and the call to action.

## Commands

Run from the repository root:

| Command                                            | Does                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm --filter @atd/promo-video studio`            | Scores the soundtrack, then opens Remotion Studio            |
| `pnpm --filter @atd/promo-video render`            | Renders both cuts to `out/atd-promo-en.mp4` and `-zh.mp4`    |
| `pnpm --filter @atd/promo-video render:en`         | Renders the English cut only (`render:zh` for Chinese)       |
| `pnpm --filter @atd/promo-video soundtrack`        | Scores `public/audio/soundtrack.wav` and its stems from code |
| `pnpm --filter @atd/promo-video typecheck`, `lint` | TypeScript, and Oxlint with the repository's rules           |

`out/` and `public/audio/` are generated and ignored by Git. The first render downloads the Chrome
Headless Shell that Remotion pins. Each cut is H.264 (CRF 15, tagged limited-range BT.709) with
320 kbps AAC, as `remotion.config.ts` sets.

## How it is built

**One clock.** `src/timeline.ts` places every scene, every beat of each scene's choreography
(`CHOREO`) and the score's bars (120 BPM, a bar every 2 s, so cuts fall on downbeats). The scenes
animate those moments and the soundtrack sounds them, so a key's click lands on the frame its dot
lights. Change timing there, not in the scenes.

**The LED display** (`src/dots/`) is the website hero redrawn with Canvas2D: words are rasterized
onto a dot grid at four samples per cell, power-on wakes the field outward and sweeps the word on,
and typing follows the hero's pace (`typing.ts`, matching `apps/website/src/gl/typing.ts`). Each
frame is a pure function of its state, as Remotion's out-of-order, parallel rendering requires.

**The Mac's screen** (`src/stage/`) is a card in space carrying the website's interface scenes,
the Figma layers in `apps/website/public/cases/layers` placed by their generated boxes
(`scene.ts`). `camera.ts` springs between per-scene shots and leans the card into its moves; each
case in `stage/cases/` animates its layers, and `Caption.tsx` sets its copy in the left column.

**Motion** uses closed-form springs (`src/motion/spring.ts`, response and damping ratio, as Apple's
frameworks describe them), so any frame can be computed on its own and velocities are exact.

**The soundtrack** is synthesized by `scripts/soundtrack.ts` from the same timeline: a score in D
major (`src/audio/score.ts`: pad, FM plucks, off-beat sub bass, a soft kit, bells), sound effects
on their cues (`cues.ts`, `effects.ts`), a shared plate reverb, and mastering to −15 LUFS with a
−1 dBFS ceiling, measured the ITU-R BS.1770 way (`master.ts`). It uses no recorded samples, so
there is nothing to license; `public/audio/stems/` keeps music and effects apart for editing.

**Copy** lives in `src/copy.ts` in both languages, taken from the website's sections and interface
captions. The display's words stay in English in both cuts because they spell out the name.

## Styling

The repository's design-system lint applies here: no inline styles except CSS custom properties.
Each component's stylesheet does the styling, and the timeline hands it per-frame values as custom
properties (`style={{ '--o': opacity }}`), mostly through the `Move` component (`src/ui/Move.tsx`)
and its `.move` class. Remotion Studio can therefore play and scrub the film but not drag its
keyframes; edit `timeline.ts` and the scenes instead.

## Assets and licenses

- Interface layers, the capabilities and their pictograms are read from the website
  (`apps/website/public/cases/layers`, `apps/website/src/sections/features/copy.ts` and
  `glyphs.ts`); update them there, as `apps/website/public/cases/README.md` describes, and the film
  follows. The film keeps its own copy of the features' lines in `src/copy.ts`, as for every scene,
  and `FEATURES.cells` in `src/timeline.ts` counts the cells the soundtrack pops.
- Provider marks come from `packages/ui/src/assets/brands`, rendered as their `sources.json` says:
  in ink for foreground marks, in their own colors otherwise. They identify services Atd connects
  to and remain their owners' trademarks.
- Fonts are Inter, Noto Sans SC and Doto from Fontsource, all under the SIL Open Font License.
- Remotion is free for individuals and companies of up to three people; larger companies need a
  [company license](https://www.remotion.dev/license) to render.
