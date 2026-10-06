import { DotGlyph } from '../../ui/dot-glyph';

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
 * The finale's lettering, drawn as an LED board in SVG so it is complete in the prerendered page. As
 * it scrolls into view its letters power on from left to right (CSS only); the board's own unlit dots
 * stay visible, so a canvas mounted behind it never has to finish the picture.
 */
export function LedWord() {
  return (
    <div className="download__word">
      <DotGlyph rows={BOARD} />
    </div>
  );
}
