import { blinkAt } from './typing.ts';
import './release.css';
import './caret.css';

interface CaretProps {
  /** Seconds on the caller's clock (sections start on bar lines, so local time blinks on the beat). */
  t: number;
  /** Held solid instead of blinking, as while typing. */
  solid?: boolean;
  /** Height in px; omitted, 1.1 em of the surrounding type (inline in a line of text). */
  height?: number | undefined;
  /** Width in px; omitted, scaled with the height. */
  width?: number | undefined;
  /** Its top-left in the parent's px; omitted, it sits inline where it is placed. */
  x?: number | undefined;
  y?: number | undefined;
  /** An extra fade, 0–1, multiplied with the blink (default 1). */
  opacity?: number;
  /** The bloom around it, 0–1 and beyond for a hit (default 0.6). */
  glow?: number;
}

/**
 * The coral caret, the film's protagonist: a rounded bar with a soft bloom that blinks on the beat
 * grid (`blinkAt`), or holds solid while it types. Inline by default (as `TypeLine` uses it), or
 * placed at `x`, `y` with a `height` as a free-standing mark.
 */
export function Caret({
  t,
  solid = false,
  height,
  width,
  x,
  y,
  opacity = 1,
  glow = 0.6,
}: CaretProps) {
  const visible = (solid ? 1 : blinkAt(t)) * opacity;
  const placed = x !== undefined && y !== undefined;
  return (
    <span
      className="r08-caret"
      data-placed={placed ? '' : undefined}
      aria-hidden="true"
      style={{
        '--caret-o': visible,
        '--caret-glow': glow,
        '--caret-h': height === undefined ? undefined : `${height}px`,
        '--caret-w': width === undefined ? undefined : `${width}px`,
        '--caret-x': placed ? `${x}px` : undefined,
        '--caret-y': placed ? `${y}px` : undefined,
      }}
    />
  );
}
