import './dot-glyph.css';

interface DotGlyphProps {
  /**
   * The bitmap, top row first: `x` is a lit dot, any other character an unlit one. All rows have the
   * same length, which sets the matrix width.
   */
  rows: readonly string[];
  /**
   * Lights the glyph as a reveal item (`data-reveal="wave"`): when it arrives, its lit dots come on
   * in a diagonal wave from the top left (dot-glyph.css).
   */
  wave?: boolean;
}

/**
 * A dot-matrix pictogram: one SVG circle per cell, lit or unlit, sized by its container. Each lit dot
 * carries its column and row as `data-x` and `data-y`, so a consumer's CSS can light the dots in
 * sequence (a hover sweep, a power-on wave) without inline styles.
 */
export function DotGlyph({ rows, wave = false }: DotGlyphProps) {
  const width = rows[0]?.length ?? 0;
  return (
    <svg
      className="dot-glyph"
      viewBox={`0 0 ${width} ${rows.length}`}
      aria-hidden="true"
      focusable="false"
      data-reveal={wave ? 'wave' : undefined}
    >
      {rows.flatMap((row, y) =>
        Array.from(row, (cell, x) => {
          const lit = cell === 'x';
          return (
            <circle
              key={`${x}.${y}`}
              className="dot-glyph__dot"
              cx={x + 0.5}
              cy={y + 0.5}
              r={0.34}
              data-lit={lit ? '' : undefined}
              data-x={lit ? x : undefined}
              data-y={lit ? y : undefined}
            />
          );
        }),
      )}
    </svg>
  );
}
