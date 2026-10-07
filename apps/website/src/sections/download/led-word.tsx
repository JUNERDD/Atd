import { useRef } from 'react';
import { useLedBoard } from './use-led-board';

/** "Atd" on a 33 × 13 LED board: 11-dot letters with two-dot strokes, framed by unlit dots. */
const BOARD = [
  '.................................',
  '......xxx...................xx...',
  '.....xxxxx.....xx...........xx...',
  '.....xx.xx.....xx...........xx...',
  '....xx...xx...xxxxx.....xxxxxx...',
  '....xx...xx...xxxxx....xxxxxxx...',
  '...xx.....xx...xx.....xx....xx...',
  '...xxxxxxxxx...xx.....xx....xx...',
  '...xxxxxxxxx...xx.....xx....xx...',
  '...xx.....xx...xx.....xx....xx...',
  '...xx.....xx...xx......xxxxxxx...',
  '...xx.....xx....xxx.....xxxxxx...',
  '.................................',
];

const COLUMNS = BOARD[0]?.length ?? 0;
/** The board's cells in reading order; download.css lays them out in BOARD's columns. */
const CELLS = BOARD.flatMap((row, y) =>
  Array.from(row, (cell, x) => ({ key: `${x}.${y}`, lit: cell === 'x' })),
);

/**
 * The finale's lettering, drawn as an LED board of HTML dots so it is complete in the prerendered
 * page and its motion runs on the compositor (an SVG board repaints whole on every frame of its
 * power-on). When the board arrives its unlit dots come up, then the letters power on column by
 * column; while it is on screen a slow wave of light runs through them, and a fine pointer swells the
 * dots around it like a loupe. The motion is CSS, staggered by each dot's column (see
 * use-led-board.ts).
 */
export function LedWord() {
  const ref = useRef<HTMLDivElement>(null);
  const live = useLedBoard(ref, COLUMNS);

  return (
    <div ref={ref} className="download__word" data-reveal="fade" data-live={live ? '' : undefined}>
      <div className="download__board" aria-hidden="true">
        {CELLS.map((cell) => (
          <span key={cell.key} className="download__dot" data-lit={cell.lit ? '' : undefined} />
        ))}
      </div>
    </div>
  );
}
