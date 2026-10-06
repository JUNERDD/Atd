import { useRef } from 'react';
import { DotGlyph } from '../../ui/dot-glyph';
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

/**
 * The finale's lettering, drawn as an LED board in SVG so it is complete in the prerendered page.
 * When the board arrives its unlit dots come up, then the letters power on column by column; while
 * it is on screen a slow wave of light runs through them, and a fine pointer swells the dots around
 * it like a loupe. The motion is CSS, staggered by each dot's column (see use-led-board.ts).
 */
export function LedWord() {
  const ref = useRef<HTMLDivElement>(null);
  const live = useLedBoard(ref);

  return (
    <div ref={ref} className="download__word" data-reveal="fade" data-live={live ? '' : undefined}>
      <DotGlyph rows={BOARD} />
    </div>
  );
}
