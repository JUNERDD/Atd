import { Fragment } from 'react';
import type { Lang } from '../../copy.ts';
import { langTag, textUnits } from '../../kit/world/text-units.ts';
import { clamp01, easeIn, ramp } from '../../motion/ease.ts';
import { springAt, type Spring } from '../../motion/spring.ts';
import { STEP } from '../timeline.ts';
import './release.css';
import './statement.css';

export type StatementMotion = 'slam' | 'rise';

interface StatementProps {
  t: number;
  lang: Lang;
  text: string;
  /** When the first word lands. */
  at: number;
  /** Seconds between words (default a sixteenth, 0.15 s); ignored where `times` is given. */
  stagger?: number;
  /** Each word's landing time, overriding `at` and `stagger` (words beyond it follow on). */
  times?: readonly number[];
  /** `slam`: drops in from large and blurred with a punch; `rise`: rises from behind its baseline. */
  motion?: StatementMotion;
  size?: 'hero' | 'statement' | 'label';
  tone?: 'fg' | 'muted';
  /** When the words leave: one time for all (staggered by `outStagger`), or one per word. */
  out?: number | readonly number[];
  /** Seconds between words leaving (default 0.04). */
  outStagger?: number;
  /** Indices of words set in coral. */
  accent?: readonly number[];
  align?: 'center' | 'left';
}

/** The slam's punch: fast, with one firm overshoot. */
const SLAM: Spring = { response: 0.34, damping: 0.62 };
/** The rise: quick off the line, a long quiet settle. */
const RISE: Spring = { response: 0.6, damping: 0.86 };

interface UnitMotion {
  o: number;
  y: number;
  s: number;
  blur: number;
}

function enter(t: number, at: number, motion: StatementMotion): UnitMotion {
  if (motion === 'slam') {
    const p = springAt(t, at, SLAM);
    return {
      o: clamp01((t - at) / 0.05),
      y: (1 - p) * -0.06,
      s: 1 + (1 - p) * 0.55,
      blur: (1 - clamp01((t - at) / 0.14)) * 16,
    };
  }
  const p = springAt(t, at, RISE);
  return { o: clamp01((t - at) / 0.12), y: (1 - p) * 1.08, s: 1, blur: 0 };
}

function leave(t: number, at: number, motion: StatementMotion, base: UnitMotion): UnitMotion {
  if (t <= at) return base;
  const p = ramp(t, at, 0.3, easeIn);
  return {
    o: base.o * (1 - clamp01((t - at) / 0.24)),
    y: base.y - p * (motion === 'rise' ? 1.1 : 0.32),
    s: base.s,
    blur: base.blur + (motion === 'rise' ? 0 : p * 10),
  };
}

/**
 * Kinetic display type: a statement whose words land on given times, slamming in from large and
 * blurred or rising from behind their baseline, with an optional staggered exit and coral accents.
 * Large Inter at display weight (Noto Sans SC 900 in Chinese). Fills its parent's width and centers
 * by default; place it with its parent.
 */
export function Statement({
  t,
  lang,
  text,
  at,
  stagger = STEP,
  times,
  motion = 'rise',
  size = 'statement',
  tone = 'fg',
  out,
  outStagger = 0.04,
  accent = [],
  align = 'center',
}: StatementProps) {
  const units = textUnits(text, lang);
  const lastTime = times?.[times.length - 1];
  return (
    <div
      className="r08-statement"
      data-size={size}
      data-tone={tone}
      data-align={align}
      data-motion={motion}
      lang={langTag(lang)}
    >
      {units.map((unit, index) => {
        const landing =
          times?.[index] ??
          (lastTime === undefined || times === undefined
            ? at + index * stagger
            : lastTime + (index - times.length + 1) * stagger);
        const leaving = typeof out === 'number' ? out + index * outStagger : out?.[index];
        const arrived = enter(t, landing, motion);
        const state = leaving === undefined ? arrived : leave(t, leaving, motion, arrived);
        return (
          <Fragment key={`${index}-${unit.text}`}>
            <span className="r08-statement__slot">
              <span
                className="r08-statement__unit"
                data-accent={accent.includes(index) ? '' : undefined}
                style={{
                  '--o': state.o,
                  '--y': state.y,
                  '--s': state.s,
                  '--blur': state.blur > 0.3 ? `blur(${state.blur.toFixed(2)}px)` : 'none',
                }}
              >
                {unit.text}
              </span>
            </span>
            {unit.space}
          </Fragment>
        );
      })}
    </div>
  );
}
