import type { Box } from './types';

/**
 * Typesetting for the dot field: how large each word is set, on how many lines, and where its lines
 * start. The rasterizer (art-raster.ts) draws what this decides.
 */

export interface ArtSpec {
  /** The words in display order. `|` marks where a word may break onto a second line. */
  words: readonly string[];
  fontFamily: string;
  fontWeight: number;
  /** Box each word's ink fills (contain-fit, centered), CSS px relative to the canvas. */
  box: Box;
  pitchRange: readonly [min: number, max: number];
}

/** A word as set: its lines and its size. */
export interface Block {
  lines: string[];
  /** Font size in CSS px that fits the block into the box. */
  size: number;
}

/** Dots across the cap height of the set's smallest word, when the pitch range allows it. */
export const CAP_ROWS = 14;
/** Cap height of the system faces, in em. */
export const CAP_HEIGHT = 0.72;
/** Baseline to baseline for a word set on two lines, in em. */
export const LINE_ADVANCE = 0.96;
/**
 * The cursor's width, and its gap from the word, as a share of the cap height in cells; never under
 * CURSOR_MIN cells, so it reads as a block rather than a line.
 */
export const CURSOR_SHARE = 0.065;
export const CURSOR_MIN = 2;

const REFERENCE_SIZE = 100;
/** A two-line layout must set the word this much larger to be worth the break. */
const BREAK_GAIN = 1.25;
/**
 * Room the cursor and its gap take after a word, in em, for fitting before the pitch is known: the
 * larger of the share and the minimum on the coarsest grid (CAP_ROWS dots across the cap height).
 */
const CURSOR_ROOM = 2 * Math.max(CURSOR_SHARE, CURSOR_MIN / CAP_ROWS) * CAP_HEIGHT;

export function fontFor(spec: ArtSpec, size: number): string {
  return `${spec.fontWeight} ${size}px ${spec.fontFamily}`;
}

/** A word's layouts: on one line, and on two lines where it may break. */
function layouts(word: string): string[][] {
  const parts = word.split('|');
  return parts.length > 1 ? [[parts.join('')], parts] : [[word]];
}

/**
 * Sets every word for the box. Each takes the layout (one or two lines) that sets it largest. The
 * words after the first, the name, then share one size, the largest at which all of them fit, so
 * typing from one to the next stays at the same size; each takes one line at that size when it
 * fits, two otherwise. The name keeps its own size.
 */
export function fitWords(ctx: CanvasRenderingContext2D, spec: ArtSpec): Block[] {
  /** The block's ink extent at the reference size, with room for the cursor after the last line. */
  const measure = (lines: readonly string[]) => {
    ctx.font = fontFor(spec, REFERENCE_SIZE);
    const metrics = lines.map((line) => ctx.measureText(line));
    const width = Math.max(
      ...metrics.map(
        (m, index) =>
          m.actualBoundingBoxLeft +
          m.actualBoundingBoxRight +
          (index === lines.length - 1 ? CURSOR_ROOM * REFERENCE_SIZE : 0),
      ),
    );
    const first = metrics[0];
    const last = metrics[metrics.length - 1];
    const height =
      (first?.actualBoundingBoxAscent ?? 0) +
      (lines.length - 1) * LINE_ADVANCE * REFERENCE_SIZE +
      (last?.actualBoundingBoxDescent ?? 0);
    return { width, height };
  };

  const fit = (word: string): Block => {
    let best: Block = { lines: [word.replaceAll('|', '')], size: 0 };
    for (const lines of layouts(word)) {
      const { width, height } = measure(lines);
      if (width <= 0 || height <= 0) continue;
      const size = REFERENCE_SIZE * Math.min(spec.box.width / width, spec.box.height / height);
      const gain = lines.length > 1 ? BREAK_GAIN : 1;
      if (size > best.size * gain) best = { lines, size };
    }
    return best;
  };

  const [name, ...tail] = spec.words.map(fit);
  const sizes = tail.map((block) => block.size).filter((size) => size > 0);
  if (!name || sizes.length === 0) return name ? [name, ...tail] : [];
  const shared = Math.min(...sizes);
  const scale = shared / REFERENCE_SIZE;
  const fits = (lines: readonly string[]) => {
    const { width, height } = measure(lines);
    return width * scale <= spec.box.width + 0.5 && height * scale <= spec.box.height + 0.5;
  };
  const set = spec.words.slice(1).map((word, index) => ({
    lines: layouts(word).find(fits) ?? tail[index]?.lines ?? [word.replaceAll('|', '')],
    size: tail[index]?.size ? shared : 0,
  }));
  return [name, ...set];
}
