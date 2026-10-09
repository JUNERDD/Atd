/**
 * Sets words on the LED display's dot grid. Canvas2D draws each word at four samples per cell
 * edge, and each cell's ink coverage is the average of its samples, as on the website hero
 * (apps/website/src/gl/art-raster.ts). Every word shares one grid, so the board can change from one
 * to the next cell by cell, and each cell remembers which character lit it so a word can show only
 * the characters typed so far.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Grid {
  pitch: number;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
}

export interface WordRaster {
  /** Ink coverage per cell, 0–255, row-major from the top-left cell. */
  coverage: Uint8Array;
  /** Per cell, the character that lights it, counting from 1 in typing order; 0 for no ink. */
  order: Uint8Array;
  /** Where the word's ink sits, in frame px. */
  ink: Box;
  /** The block cursor after each typed prefix, from none typed to the whole word, in frame px. */
  cursors: Box[];
}

export interface FieldRaster {
  grid: Grid;
  words: WordRaster[];
}

export interface RasterSpec {
  width: number;
  height: number;
  pitch: number;
  /** The display's words; the first is the name, set as large as it fits. */
  words: readonly string[];
  /** The box each word is fitted into, in frame px. */
  box: Box;
  fontFamily: string;
  fontWeight: number;
}

const SUPERSAMPLE = 4;
const REFERENCE = 100;
/**
 * The cursor's width and its gap from the word, as a share of the cap height; never under 3 cells.
 * Wider than the website's two-cell bar: a still frame of the film has no blink to tell a narrow
 * cursor from a letter l.
 */
const CURSOR_SHARE = 0.16;
const CURSOR_MIN = 3;

const cache = new Map<string, FieldRaster>();

/** The set rasters for a spec, computed once per spec. Call only once the font has loaded. */
export function rasterize(spec: RasterSpec): FieldRaster {
  const key = JSON.stringify(spec);
  const cached = cache.get(key);
  if (cached) return cached;
  const raster = build(spec);
  cache.set(key, raster);
  return raster;
}

function build(spec: RasterSpec): FieldRaster {
  const { width, height, pitch } = spec;
  const cols = Math.ceil(width / pitch) + 1;
  const rows = Math.ceil(height / pitch) + 1;
  const grid: Grid = {
    pitch,
    cols,
    rows,
    originX: (width - cols * pitch) / 2,
    originY: (height - rows * pitch) / 2,
  };
  const canvas = document.createElement('canvas');
  canvas.width = cols * SUPERSAMPLE;
  canvas.height = rows * SUPERSAMPLE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('The LED display needs a 2D canvas.');

  const font = (size: number) => `${spec.fontWeight} ${size}px ${spec.fontFamily}`;
  ctx.font = font(REFERENCE);
  const capRatio = ctx.measureText('H').actualBoundingBoxAscent / REFERENCE;

  /** The largest size at which a word and its cursor fit the box, its cap height at most 82% of it. */
  const fit = (word: string): number => {
    ctx.font = font(REFERENCE);
    const m = ctx.measureText(word);
    const inkWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const room = 2 * CURSOR_SHARE * capRatio * REFERENCE;
    const byWidth = ((spec.box.width - 2 * CURSOR_MIN * pitch) / (inkWidth + room)) * REFERENCE;
    const byHeight = (spec.box.height * 0.82) / capRatio;
    return Math.min(byWidth, byHeight);
  };
  const [name, ...rest] = spec.words;
  const shared = Math.min(...rest.map(fit));
  const sizes = spec.words.map((word) => (word === name ? fit(word) : shared));

  const k = SUPERSAMPLE / pitch;
  const read = (into: Uint8Array) => {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const area = SUPERSAMPLE * SUPERSAMPLE;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let sum = 0;
        for (let dy = 0; dy < SUPERSAMPLE; dy++) {
          let alpha = ((row * SUPERSAMPLE + dy) * canvas.width + col * SUPERSAMPLE) * 4 + 3;
          for (let dx = 0; dx < SUPERSAMPLE; dx++, alpha += 4) sum += data[alpha] ?? 0;
        }
        into[row * cols + col] = Math.round(sum / area);
      }
    }
  };

  const words = spec.words.map((word, index): WordRaster => {
    const size = sizes[index] ?? shared;
    ctx.font = font(size);
    const m = ctx.measureText(word);
    const cap = capRatio * size;
    const cursorWidth = Math.max(CURSOR_MIN, Math.round((CURSOR_SHARE * cap) / pitch)) * pitch;
    const inkWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const blockWidth = inkWidth + 2 * cursorWidth;
    // The cap height is centered in the box, so words with and without descenders share a line.
    const originX = spec.box.x + (spec.box.width - blockWidth) / 2 + m.actualBoundingBoxLeft;
    const baseline = spec.box.y + (spec.box.height + cap) / 2;

    const draw = (text: string) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(k, 0, 0, k, -grid.originX * k, -grid.originY * k);
      ctx.font = font(size);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, originX, baseline);
    };

    const coverage = new Uint8Array(cols * rows);
    draw(word);
    read(coverage);
    const chars = Array.from(word);
    const order = new Uint8Array(cols * rows);
    const prefix = new Uint8Array(cols * rows);
    for (let typed = 1; typed <= chars.length; typed++) {
      if (typed < chars.length) {
        draw(chars.slice(0, typed).join(''));
        read(prefix);
      } else prefix.set(coverage);
      for (let i = 0; i < order.length; i++) {
        const full = coverage[i] ?? 0;
        if (order[i] === 0 && full > 0 && (prefix[i] ?? 0) >= full * 0.5) order[i] = typed;
      }
    }

    // The cursor stands on the baseline, as tall as the capitals, a gap past the typed ink, on
    // whole cells. With nothing typed it waits where the first character will land.
    const snapX = (x: number) => grid.originX + Math.round((x - grid.originX) / pitch) * pitch;
    const snapY = (y: number) => grid.originY + Math.round((y - grid.originY) / pitch) * pitch;
    const top = snapY(baseline - cap);
    const bottom = snapY(baseline);
    const inkStart = originX - m.actualBoundingBoxLeft;
    const cursors = Array.from({ length: chars.length + 1 }, (_, typed): Box => {
      const end =
        typed === 0
          ? inkStart - cursorWidth
          : originX + ctx.measureText(chars.slice(0, typed).join('')).actualBoundingBoxRight;
      return { x: snapX(end + cursorWidth), y: top, width: cursorWidth, height: bottom - top };
    });

    return {
      coverage,
      order,
      cursors,
      ink: {
        x: inkStart,
        y: baseline - m.actualBoundingBoxAscent,
        width: inkWidth,
        height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
      },
    };
  });

  return { grid, words };
}
