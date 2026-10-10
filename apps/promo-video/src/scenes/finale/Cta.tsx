import { keyTravel } from '../../kit/world/keycap.ts';
import { clamp01, mix } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';

interface CtaProps {
  t: number;
  /** When the key lands: it rises in just before and is pressed on this beat. */
  at: number;
  label: string;
}

/**
 * The call to action as a key: a white cap in the macro keycaps' language (a face over a side
 * wall, sinking as it is pressed and springing back), rising into place and pressed once as it
 * lands, the last key of the film.
 */
export function Cta({ t, at, label }: CtaProps) {
  const shown = springAt(t, at - 0.16, springs.pop);
  const travel = keyTravel(t, at, at + 0.1);
  return (
    <div
      className="cta"
      style={{
        '--o': clamp01(shown * 2),
        '--rise': mix(0.6, 0, shown),
        '--blur': `${(1 - clamp01(shown)) * 8}px`,
        '--travel': travel,
      }}
    >
      <div className="cta__wall" />
      <div className="cta__top">{label}</div>
    </div>
  );
}
