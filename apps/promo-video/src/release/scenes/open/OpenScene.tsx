import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Lang } from '../../../copy.ts';
import { useFontsReady } from '../../../fonts.ts';
import { clamp01, ramp } from '../../../motion/ease.ts';
import { springAt, type Spring } from '../../../motion/spring.ts';
import { CaretWipe } from '../../world/CaretWipe.tsx';
import { DotField } from '../../world/DotField.tsx';
import type { Pulse } from '../../world/dots.ts';
import { Statement } from '../../world/Statement.tsx';
import { OPEN_BEATS as B, OPEN_TYPING, streamTimes } from './beats.ts';
import { keystrokeOffsets, type CenteredTypeInput, type TypeSet } from './centered-type.ts';
import { CenteredType } from './CenteredType.tsx';
import { content } from './content.ts';
import { OpenExit } from './OpenExit.tsx';
import './open.css';

/** Where things sit, in frame px: the typed line's center, the title's, and its line's. */
const LINE = { x: 960, y: 540 };
const TITLE = { x: 960, y: 470 };
const TITLE_LINE = { x: 960, y: 690 };
/** Roughly where "0.8" lands, for its own ring. */
const VERSION_X = 1190;

/** The typed line reads as writing, not display type; the title line is firmer. */
const SETS = {
  en: {
    line: { size: 76, weight: 500, tracking: -0.018 },
    titleLine: { size: 64, weight: 620, tracking: -0.022 },
  },
  zh: {
    line: { size: 76, weight: 500, tracking: 0 },
    titleLine: { size: 64, weight: 700, tracking: 0.02 },
  },
} as const satisfies Record<Lang, Record<'line' | 'titleLine', TypeSet>>;

/** The drop's push on the dots: a jolt toward the viewer that settles with one soft rebound. */
const PUNCH: Spring = { response: 0.5, damping: 0.62 };

/** A soft ring under the caret as it blinks, and a coral fleck under every keystroke. */
function pulses(lineInput: CenteredTypeInput, titleInput: CenteredTypeInput): Pulse[] {
  const out: Pulse[] = B.blinks.map((at, index) => ({
    ...LINE,
    at,
    strength: 0.42 - index * 0.06,
    speed: 640,
  }));
  for (const [input, origin] of [
    [lineInput, LINE],
    [titleInput, TITLE_LINE],
  ] as const) {
    for (const { at, x } of keystrokeOffsets(input)) {
      out.push({ x: origin.x + x, y: origin.y, at, strength: 0.1, speed: 420, tint: 'coral' });
    }
  }
  out.push({ ...LINE, at: B.retype, strength: 0.65, speed: 900, tint: 'coral' });
  out.push({ ...TITLE, at: B.drop, strength: 1.5 });
  out.push({ x: VERSION_X, y: TITLE.y, at: B.version, strength: 0.9 });
  return out;
}

/**
 * The caret's hook. Out of black, the coral caret blinks alone at the center as the grid lifts;
 * a hurried line pours out of it; a drag selection sweeps it; it is rewritten in place at the
 * app's own pace (the whole 0.8 idea without an interface). On bar 2's downbeat "Atd 0.8" slams
 * in over a ring of light, its line is typed beneath, and the caret wipes across to the Stage.
 */
export function OpenScene({ lang }: { lang: Lang }) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const c = content[lang];
  const typing = OPEN_TYPING[lang];
  const sets = SETS[lang];

  const lineInput: CenteredTypeInput = {
    t,
    set: sets.line,
    text: { text: c.rough, times: streamTimes(c.rough, typing.rough) },
    select: { at: B.select, duration: B.selectLength },
    replace: {
      text: c.polished,
      times: streamTimes(c.polished, typing.polished),
      at: B.retype,
    },
  };
  const titleInput: CenteredTypeInput = {
    t,
    set: sets.titleLine,
    text: { text: c.titleLine, times: streamTimes(c.titleLine, typing.titleLine) },
  };

  // The line is blown away as the title lands: lifted, blurred, gone in a sixth of a second.
  const leave = ramp(t, B.drop, 0.16);
  const push = 1 + 0.025 * clamp01(t / B.drop);
  const zoom = t < B.drop ? push : 1 + 0.06 * (1 - springAt(t, B.drop, PUNCH));

  const picture = (
    <AbsoluteFill>
      <DotField
        t={t}
        opacity={ramp(t, B.gridIn, B.gridLength)}
        view={{ x: 960, y: 540, zoom }}
        pulses={pulses(lineInput, titleInput)}
      />
      <div className="r08-open__black" style={{ '--o': 1 - ramp(t, B.start, 1.1) }} />
      {t < B.drop + 0.3 ? (
        <div
          className="r08-open__line"
          style={{
            '--o': 1 - leave,
            '--lift': `${-22 * leave}px`,
            '--blur': `${14 * leave}px`,
            '--shrink': 1 - 0.06 * leave,
          }}
        >
          <CenteredType {...lineInput} lang={lang} caret={{ until: B.drop }} />
        </div>
      ) : null}
      {t >= B.drop ? (
        <>
          <div
            className="r08-open__title"
            style={{ '--drift': 1 + 0.018 * ramp(t, B.drop, B.end - B.drop, (x) => x) }}
          >
            <Statement
              t={t}
              lang={lang}
              text={c.title}
              at={B.drop}
              times={[B.drop, B.version]}
              motion="slam"
              size="hero"
              accent={[1]}
            />
          </div>
          <div className="r08-open__title-line">
            <CenteredType {...titleInput} lang={lang} caret={{ from: B.titleLine }} />
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill className="scene r08">
      <CaretWipe
        t={t}
        at={B.wipe}
        duration={B.wipeLength}
        outgoing={picture}
        incoming={<OpenExit lang={lang} t={t - B.last} />}
      />
    </AbsoluteFill>
  );
}
