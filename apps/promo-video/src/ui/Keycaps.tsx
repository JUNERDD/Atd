import { mix, ramp } from '../motion/ease.ts';
import { springAt, springs } from '../motion/spring.ts';
import './keycaps.css';

const KEYS = [
  { label: '⌘', wide: false },
  { label: '⇧', wide: false },
  { label: 'Space', wide: true },
] as const;

interface KeycapsProps {
  t: number;
  /** When the keys rise into view, one after another. */
  appearAt: number;
  /** When each key goes down, in order; they come back up together at `releaseAt`. */
  pressAt: readonly number[];
  releaseAt: number;
  size?: number;
}

/** The shortcut that summons Atd, pressed key by key. */
export function Keycaps({ t, appearAt, pressAt, releaseAt, size = 64 }: KeycapsProps) {
  return (
    <div className="keycaps" style={{ '--key': size }}>
      {KEYS.map((key, index) => {
        const shown = springAt(t, appearAt + index * 0.07, springs.pop);
        const at = pressAt[index];
        const down = at === undefined ? 0 : ramp(t, at, 0.05) * (1 - ramp(t, releaseAt, 0.14));
        return (
          <div
            key={key.label}
            className="keycap"
            data-wide={key.wide ? '' : undefined}
            style={{
              '--down': down,
              '--o': Math.min(1, shown * 2.4),
              '--y': `${mix(18, 0, shown)}px`,
              '--s': mix(0.8, 1, shown),
            }}
          >
            <div className="keycap__face">{key.label}</div>
          </div>
        );
      })}
    </div>
  );
}
