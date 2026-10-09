import { clamp01, mix } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';

interface DotGlyphProps {
  /** Rows top first; `x` is a lit dot. */
  rows: readonly string[];
  t: number;
  /** When the first dot lights; the rest follow in a diagonal sweep. */
  at: number;
  pitch: number;
}

/**
 * A 9 × 9 pictogram on a little LED panel: unlit dots stay faint, and the lit ones swell on in a
 * sweep from the top-left corner, as the website's feature cells draw theirs.
 */
export function DotGlyph({ rows, t, at, pitch }: DotGlyphProps) {
  const size = rows.length * pitch;
  return (
    <svg className="feature__glyph" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rows.flatMap((row, y) =>
        Array.from(row).map((cell, x) => {
          // The swell may overshoot its size a little; the light never goes past full.
          const on = cell === 'x' ? Math.max(0, springAt(t, at + (x + y) * 0.022, springs.pop)) : 0;
          return (
            <circle
              key={`${x}-${y}`}
              cx={(x + 0.5) * pitch}
              cy={(y + 0.5) * pitch}
              r={pitch * mix(0.17, 0.36, on)}
              fill="currentColor"
              fillOpacity={mix(0.12, 1, clamp01(on))}
            />
          );
        }),
      )}
    </svg>
  );
}
