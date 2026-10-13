import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Lang } from '../../../copy.ts';
import { useFontsReady } from '../../../fonts.ts';
import { DropsMark } from '../../../kit/world/DropsMark.tsx';
import { Keycaps } from '../../../kit/world/Keycaps.tsx';
import { langTag } from '../../../kit/world/text-units.ts';
import { clamp01, easeInOut, mix, ramp } from '../../../motion/ease.ts';
import { springAt, type Spring } from '../../../motion/spring.ts';
import { Caret } from '../../world/Caret.tsx';
import { DotField } from '../../world/DotField.tsx';
import type { Pulse } from '../../world/dots.ts';
import { keystrokeOffsets, type CenteredTypeInput } from '../open/centered-type.ts';
import { CenteredType } from '../open/CenteredType.tsx';
import { FINALE_BEATS as B, FINALE_ENTRY, FINALE_TYPING, streamTimes } from './beats.ts';
import { content } from './content.ts';
import {
  ADDRESS,
  BLOCK_RISE,
  CENTER,
  entryCaretTarget,
  KEYS,
  LINE,
  LOCKUP,
  MARK,
  MARK_GAP,
  SETS,
  WORD,
} from './layout.ts';
import './finale.css';

/** The jolt on the impact, and the block's glide when Return adds the tagline. */
const PUNCH: Spring = { response: 0.5, damping: 0.62 };
const GLIDE: Spring = { response: 0.62, damping: 0.92 };
/** The entry caret growing into the lockup's caret: quick, with a breath of overshoot. */
const GROW: Spring = { response: 0.42, damping: 0.8 };

/** How hot the caret burns: resting until the impact, flaring on it, then cooling. */
function caretGlow(t: number): number {
  if (t < B.impact) return 0.6;
  return 0.6 + 2.8 * Math.exp(-(t - B.impact) / 0.3);
}

/** The field: exactly at rest on the first frame, a jolt on the impact, then a slow push. */
function fieldZoom(t: number): number {
  if (t < B.impact) return 1;
  return 1 + 0.05 * (1 - springAt(t, B.impact, PUNCH)) + 0.03 * clamp01(t / B.end);
}

function pulses(inputs: readonly [CenteredTypeInput, { x: number; y: number }][]): Pulse[] {
  const out: Pulse[] = [
    { ...CENTER, at: B.impact, strength: 1.5 },
    { ...CENTER, at: B.grow, strength: 0.8, tint: 'coral' },
    { x: CENTER.x - (MARK + MARK_GAP) / 2, y: CENTER.y, at: B.mark + 0.39, strength: 0.6 },
    { ...KEYS, at: B.chord, strength: 0.5, speed: 800 },
    { ...CENTER, at: B.ring, strength: 0.8, speed: 620 },
  ];
  for (const [input, origin] of inputs) {
    for (const { at, x } of keystrokeOffsets(input)) {
      out.push({ x: origin.x + x, y: origin.y, at, strength: 0.1, speed: 420, tint: 'coral' });
    }
  }
  return out;
}

/**
 * The sign-off. It opens on the caret the mosaic converged into; on the hit it flares and grows
 * into the lockup's caret, which types the Atd lockup (the mark snapping together as its first
 * glyph, then the wordmark), presses Return (the block glides up to stay centered) and types the
 * tagline; the shortcut rises and is pressed as a chord; on the last chord the caret types the
 * address over the specs; and everything resolves to black by the film's last frame.
 */
export function FinaleScene({ lang }: { lang: Lang }) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const c = content[lang];
  const sets = SETS[lang];
  const typing = FINALE_TYPING[lang];

  const lockup: CenteredTypeInput = {
    t,
    set: WORD,
    text: { text: c.word, times: B.word },
    lead: { at: B.mark, width: MARK + MARK_GAP },
  };
  const line: CenteredTypeInput = {
    t,
    set: sets.line,
    text: { text: c.line, times: streamTimes(c.line, typing.line) },
  };
  const url: CenteredTypeInput = {
    t,
    set: sets.url,
    text: { text: c.url, times: streamTimes(c.url, typing.url) },
  };
  const fade = 1 - ramp(t, B.fade, B.black - B.fade, easeInOut);
  const specs = springAt(t, B.specs, { response: 0.7, damping: 1 });
  const rise = BLOCK_RISE * springAt(t, B.ret, GLIDE);
  // The entry caret: the contract picture on the first frame, grown into the lockup's caret by
  // the mark, where the line's own caret takes over at the same place and size.
  const grow = springAt(t, B.grow, GROW);
  const target = entryCaretTarget();

  return (
    <AbsoluteFill className="scene r08">
      <DotField
        t={t}
        opacity={fade}
        view={{ ...CENTER, zoom: fieldZoom(t) }}
        pulses={pulses([
          [lockup, { x: LOCKUP.x, y: LOCKUP.y + BLOCK_RISE }],
          [line, LINE],
          [url, ADDRESS],
        ])}
      />
      <div
        className="r08-finale__flash"
        style={{ '--o': t < B.impact ? 0 : Math.exp(-(t - B.impact) / 0.12) * 0.5 }}
      />
      {t < B.mark ? (
        <Caret
          t={t}
          solid
          x={mix(FINALE_ENTRY.x, target.x, grow)}
          y={mix(FINALE_ENTRY.y, target.y, grow)}
          height={mix(FINALE_ENTRY.height, target.height, grow)}
          glow={caretGlow(t)}
        />
      ) : null}
      <div className="r08-finale__card" style={{ '--fade': fade }}>
        <div className="r08-finale__block" style={{ '--block-y': `${BLOCK_RISE - rise}px` }}>
          <div className="r08-finale__lockup">
            <CenteredType
              {...lockup}
              lang={lang}
              caret={{ from: B.mark, until: B.ret, glow: caretGlow(t) }}
              leadNode={
                <DropsMark
                  formation={ramp(t, B.mark, 0.5, (x) => x)}
                  settle={ramp(t, B.mark + 0.45, 0.6)}
                  size={MARK}
                  reach={0.55}
                />
              }
            />
          </div>
          <div className="r08-finale__line">
            <CenteredType {...line} lang={lang} caret={{ from: B.ret, until: B.url }} />
          </div>
        </div>
        <div className="r08-finale__keys">
          <Keycaps
            t={t}
            variant="hint"
            size={52}
            appearAt={B.keys}
            keys={[
              { legend: '⌘', press: B.chord, release: B.chordUp },
              { legend: '⇧', press: B.chord + 0.03, release: B.chordUp },
              { legend: 'Space', press: B.chord + 0.06, release: B.chordUp },
            ]}
          />
        </div>
        <div className="r08-finale__url">
          <CenteredType {...url} lang={lang} caret={{ from: B.url }} />
        </div>
        <div
          className="r08-finale__specs"
          lang={langTag(lang)}
          style={{ '--o': clamp01(specs * 1.4), '--rise': `${(1 - specs) * 14}px` }}
        >
          {c.specs}
        </div>
      </div>
      <div className="r08-finale__black" style={{ '--o': 1 - fade }} />
    </AbsoluteFill>
  );
}
