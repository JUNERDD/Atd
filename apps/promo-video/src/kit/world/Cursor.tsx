import type { CursorKind, CursorState } from './cursor.ts';
import './cursor.css';

/** A 180° shutter at 60 fps: each frame exposes 1/120 s of the motion. */
const SHUTTER = 1 / 120;
/** Ghost copies per unit of smear, and the most a frame draws. */
const GHOSTS_PER_UNIT = 0.8;
const MAX_GHOSTS = 14;

/** The macOS arrow, tip at (0, 0), in a box with room for its outline. */
const ARROW = 'M0 0V16.6L3.95 12.85L6.65 19L9.1 17.95L6.45 11.95H11.75Z';

/** Each shape's box and hotspot (the point that sits on the cursor's position). */
const SHAPES: Record<
  CursorKind,
  { viewBox: string; width: number; height: number; hot: [number, number] }
> = {
  arrow: { viewBox: '-2 -2 16 24', width: 16, height: 24, hot: [2, 2] },
  hand: { viewBox: '0 0 24 26', width: 24, height: 26, hot: [9.8, 1.3] },
};

function Arrow() {
  return <path className="cursor__shape" d={ARROW} />;
}

/** The pointing hand, built from rounded parts drawn twice: outlined, then filled over the seams. */
function Hand() {
  const parts = (
    <>
      <rect x="8" y="0.5" width="3.6" height="13" rx="1.8" />
      <rect x="11.3" y="7" width="3.4" height="7.5" rx="1.7" />
      <rect x="14.4" y="7.9" width="3.3" height="7" rx="1.65" />
      <rect x="17.4" y="9.2" width="3.1" height="6" rx="1.55" />
      <path d="M8 11.5H20.5V16.5C20.5 20.4 18.4 23.6 15 23.6H12.4C10.6 23.6 9.4 22.9 8.3 21.6L4.2 16.4C3.6 15.6 3.8 14.5 4.6 14C5.3 13.5 6.3 13.6 6.9 14.3L8 15.6Z" />
    </>
  );
  return (
    <>
      <g className="cursor__outline">{parts}</g>
      <g className="cursor__fill">{parts}</g>
      <path className="cursor__creases" d="M11.4 11.6V14.4M14.5 12.4V14.8M17.5 13.2V15.2" />
    </>
  );
}

interface CursorProps {
  /** From `cursorAt(t, keys)`; positions are in the units of the layer it is drawn in. */
  state: CursorState;
  /** Size multiplier; 1 is a Mac's default pointer size, a touch larger for legibility on film. */
  size?: number;
  opacity?: number;
}

/**
 * The macOS pointer, drawn in SVG (black, white outline, soft shadow) so close-ups stay crisp: the
 * arrow, or the pointing hand over links. It sits with its hotspot on the state's position, dips to
 * 0.9 when pressed, and smears along its velocity like a frame exposed at 1/120 s.
 */
export function Cursor({ state, size = 1, opacity = 1 }: CursorProps) {
  const shape = SHAPES[state.kind];
  const smear = state.speed * SHUTTER;
  // Enough copies that neighbours overlap, so the smear reads as a streak, not a comb.
  const ghosts = smear > 1.5 ? Math.min(MAX_GHOSTS, Math.ceil(smear * GHOSTS_PER_UNIT)) : 0;
  const step = ghosts > 0 ? SHUTTER / ghosts : 0;
  const drawing = state.kind === 'arrow' ? <Arrow /> : <Hand />;
  return (
    <div className="cursor" style={{ '--x': state.x, '--y': state.y, '--o': opacity }}>
      {Array.from({ length: ghosts + 1 }, (_, index) => ghosts - index).map((ghost) => (
        <svg
          key={ghost}
          className="cursor__svg"
          data-ghost={ghost > 0 ? '' : undefined}
          viewBox={shape.viewBox}
          aria-hidden="true"
          style={{
            '--w': shape.width * size,
            '--h': shape.height * size,
            '--hx': shape.hot[0] * size,
            '--hy': shape.hot[1] * size,
            '--s': state.scale,
            '--gx': -state.vx * step * ghost,
            '--gy': -state.vy * step * ghost,
            '--go': ghost === 0 ? 1 : (1.6 / ghosts) * (1 - ghost / (ghosts + 1)),
          }}
        >
          {drawing}
        </svg>
      ))}
    </div>
  );
}
