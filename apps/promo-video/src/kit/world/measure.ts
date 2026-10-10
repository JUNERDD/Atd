/**
 * Text measurement for layouts that must know a word's width before the browser lays it out (the
 * wordmark's slide, the chapter word's shared gradient). It reads the same faces the film loads;
 * frames are captured only after `useFontsReady` has them, so the result is stable per frame.
 */
import { graphemes } from './text-units.ts';

let context: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/**
 * The advance width of `text` in `em`, set in Inter (or Noto Sans SC) at `weight` with
 * `trackingEm` letter spacing. Falls back to an estimate where no canvas exists (Node).
 */
export function textWidthEm(text: string, weight: number, trackingEm = 0): number {
  const key = `${weight}|${trackingEm}|${text}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  if (typeof document === 'undefined') return graphemes(text).length * (0.62 + trackingEm);
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return graphemes(text).length * (0.62 + trackingEm);
  const size = 100;
  context.font = `${weight} ${size}px 'Inter Variable', 'Noto Sans SC Variable', sans-serif`;
  context.letterSpacing = `${trackingEm * size}px`;
  const width = context.measureText(text).width / size;
  // Only cache once the face is in, or an early fallback-face measurement would stick.
  if (document.fonts.check(context.font, text)) cache.set(key, width);
  return width;
}
