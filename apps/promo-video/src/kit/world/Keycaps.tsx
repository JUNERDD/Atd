import { clamp01, mix } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { keyTravel } from './keycap.ts';
import './keycaps.css';

export type KeyLegend = '⌘' | '⇧' | '⌥' | 'Space' | '2' | 'T';

export interface KeySpec {
  legend: KeyLegend;
  /** When the key goes down, in seconds on the same clock as `t`; omit for a key at rest. */
  press?: number;
  /** When it comes back up (a chord releases its keys together); default: a short tap. */
  release?: number;
  /** Light blooming from under this key, 0–1 (the Open's Space). */
  glow?: number;
}

interface KeycapsProps {
  /** Seconds, section-local; every key's motion is a pure function of it. */
  t: number;
  keys: readonly KeySpec[];
  /**
   * `macro`: big sculpted caps in perspective, for full-frame shots. `hint`: small flat caps for
   * on-screen shortcut hints (place them in points inside `Desktop`, or in px over the frame).
   */
  variant?: 'macro' | 'hint';
  /** A key's height (one key unit), in px. Default 220 for macro, 30 for hint. */
  size?: number;
  /** When the keys rise into view, one after another; omit to show them from the start. */
  appearAt?: number;
  /** Shallow depth of field (macro): blur grows with distance from key index `focus`. 0–1. */
  dof?: number;
  /** The key in focus, as a fractional index. Default: the middle of the row. */
  focus?: number;
}

const WIDTH: Record<KeyLegend, number> = {
  '⌘': 1,
  '⇧': 1,
  '⌥': 1,
  Space: 2.7,
  '2': 1,
  T: 1,
};

/**
 * A row of keycaps pressed by time. Macro caps are sculpted (a top face with its dish and sheen
 * over a side wall) and tilted away in perspective; pressing sinks the face into the wall and
 * releasing springs it back. Each key's light can bloom from beneath it.
 */
export function Keycaps({
  t,
  keys,
  variant = 'macro',
  size = variant === 'macro' ? 220 : 30,
  appearAt,
  dof = 0,
  focus = (keys.length - 1) / 2,
}: KeycapsProps) {
  return (
    <div className="keycaps" data-variant={variant} style={{ '--u': `${size}px` }}>
      <div className="keycaps__row">
        {keys.map((key, index) => {
          const travel = key.press === undefined ? 0 : keyTravel(t, key.press, key.release);
          const shown =
            appearAt === undefined ? 1 : springAt(t, appearAt + index * 0.08, springs.pop);
          const focusBlur = variant === 'macro' ? dof * Math.abs(index - focus) * 0.022 : 0;
          const arriveBlur = (1 - clamp01(shown)) * 0.08;
          return (
            <div
              key={`${key.legend}-${index}`}
              className="keycap"
              data-legend={key.legend}
              style={{
                '--w': WIDTH[key.legend],
                '--travel': travel,
                '--pressed': clamp01(travel),
                '--glow': key.glow ?? 0,
                '--o': clamp01(shown * 2),
                '--rise': mix(0.5, 0, shown),
                '--blur': focusBlur + arriveBlur,
              }}
            >
              <div className="keycap__light" />
              <div className="keycap__well" />
              <div className="keycap__wall" />
              <div className="keycap__top">
                <span className="keycap__legend">{key.legend}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
