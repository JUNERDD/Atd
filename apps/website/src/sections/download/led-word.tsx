import { LedBoard } from '../../ui/led-board';

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
 * The finale's lettering on the shared LED board: the unlit dots come up as the board arrives, then
 * the letters power on column by column; while it is on screen a slow wave of light runs through
 * them (download.css), and a fine pointer swells the dots around it like a loupe.
 */
export function LedWord() {
  return <LedBoard rows={BOARD} />;
}
