import { DROP_PATHS, DROPS_VIEWBOX } from './drops.ts';
import './drops.css';

interface DropsSymbolProps {
  /** The box's side, in the parent's pixels (points inside `Desktop`). Default: 1em. */
  size?: number;
}

/**
 * The static Atd mark for small UI (menu bar, panel header, chips): the master's two paths in their
 * square box, filled with `currentColor`, so its color comes from the surrounding text.
 */
export function DropsSymbol({ size }: DropsSymbolProps) {
  return (
    <svg
      className="drops-symbol"
      viewBox={DROPS_VIEWBOX}
      aria-hidden="true"
      style={{ '--size': size === undefined ? undefined : `${size}px` }}
    >
      <path d={DROP_PATHS.upper} />
      <path d={DROP_PATHS.lower} />
    </svg>
  );
}
