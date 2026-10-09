import { useRef } from 'react';
import { useLedBoard } from './use-led-board';
import './led-board.css';

interface LedBoardProps {
  /**
   * The bitmap, top row first: `x` is a lit dot, any other character an unlit one. All rows have the
   * same length, which sets the board's width in dots.
   */
  rows: readonly string[];
  /** Holds the power-on back this many ms after the board's reveal slot. */
  delay?: number;
}

/**
 * A board of LED dots, drawn in HTML so it is complete in the prerendered page and its motion runs on
 * the compositor (an SVG board repaints whole on every frame of its power-on). The board is a reveal
 * item: when it arrives its lit dots power on column by column (led-board.css). While it is on screen
 * it is marked `data-live`, for a consumer's idle motion, and under a fine pointer the dots around
 * the pointer swell like a loupe (use-led-board.ts).
 */
export function LedBoard({ rows, delay }: LedBoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const live = useLedBoard(ref);

  return (
    <div
      ref={ref}
      className="led-board"
      aria-hidden="true"
      data-reveal="fade"
      data-reveal-delay={delay}
      data-live={live ? '' : undefined}
    >
      {rows.map((row, y) => (
        <div key={`row.${y}`} className="led-board__row">
          {Array.from(row, (cell, x) => (
            <span
              key={`${x}.${y}`}
              className="led-board__dot"
              data-lit={cell === 'x' ? '' : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
