import { Keycaps, type KeySpec } from '../../../kit/world/Keycaps.tsx';
import { clamp01, easeIn, ramp } from '../../../motion/ease.ts';
import { CHOOSE_BEATS as B, chooseKeys } from './beats.ts';
import { KEYS_AT } from './layout.ts';

/** One picture in the key slot: some caps, shown from `from` until `to`. */
interface KeyShot {
  /** Indexes into `chooseKeys`. */
  keys: readonly number[];
  from: number;
  to: number;
  /** Rise in one after another (default); off when the same cap simply goes down again. */
  rise?: boolean;
  /** Leave with a quick drop and fade (default); off when the next shot is the same cap. */
  leave?: boolean;
  size: number;
}

/**
 * What the slot shows, in order: the tap's chord, the hold's chord, then each key the card
 * takes as it is pressed (Space, ↓, ↓ again on the same cap, 4, ↩), and ⌥ held for the drag.
 */
const SHOTS: readonly KeyShot[] = [
  { keys: [0, 1], from: B.keysIn, to: B.tapDone, size: 132 },
  { keys: [2, 3], from: B.holdSelect, to: B.holdUp + 0.15, size: 132 },
  { keys: [4], from: B.holdUp + 0.15, to: B.moves[0] - 0.15, size: 104 },
  { keys: [5], from: B.moves[0] - 0.15, to: B.moves[1] - 0.06, leave: false, size: 124 },
  { keys: [6], from: B.moves[1] - 0.06, to: B.pick - 0.1, rise: false, size: 124 },
  { keys: [7], from: B.pick - 0.1, to: B.holdRun - 0.15, size: 124 },
  { keys: [8], from: B.holdRun - 0.15, to: B.holdWrite, size: 124 },
  { keys: [9], from: B.dragStart - 0.3, to: B.dragUp + 0.3, size: 132 },
];

const LEAVE = 0.14;

/** The hold's charge, lit under T: up over the 300 ms threshold, then fading as the card opens. */
function charge(t: number): number {
  const up = clamp01((t - B.holdKey) / (B.cardOpen - B.holdKey));
  return up * (1 - ramp(t, B.cardOpen, 0.5));
}

/**
 * The macro keycaps in the left column, pressed exactly when the beats say (`chooseKeys`): the
 * keyboard's side of every run, a picture per gesture, rising in and dropping away on the grid.
 */
export function KeyCam({ t }: { t: number }) {
  return (
    <div className="r08-choose__keys" style={{ '--kx': KEYS_AT.x, '--ky': KEYS_AT.y }}>
      {SHOTS.map((shot) => {
        const leaving = shot.leave === false ? 0 : clamp01((t - shot.to) / LEAVE);
        const end = shot.leave === false ? shot.to : shot.to + LEAVE;
        if (t < shot.from || t >= end) return null;
        const keys: KeySpec[] = shot.keys.map((index) => {
          const key = chooseKeys[index];
          if (!key) return { legend: '' };
          return {
            legend: key.legend,
            press: key.down,
            release: key.up,
            ...(index === 3 ? { glow: charge(t) } : {}),
          };
        });
        const out = easeIn(leaving);
        return (
          <div
            key={shot.from}
            className="r08-choose__keyshot"
            style={{
              '--o': 1 - out,
              '--drop': out * 40,
              '--blur': `${out * 8}px`,
            }}
          >
            <Keycaps
              t={t}
              keys={keys}
              size={shot.size}
              dof={0.4}
              {...(shot.rise === false ? {} : { appearAt: shot.from })}
            />
          </div>
        );
      })}
    </div>
  );
}
