import { signedDistance } from './sdf';
import type { Box } from './types';

/** Dot grid geometry in CSS px. The grid is centered on the canvas and overhangs it by up to one cell. */
export interface GridLayout {
  pitch: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
}

export interface ArtSpec {
  /** The words in display order. `|` marks where a word may break onto a second line. */
  words: readonly string[];
  fontFamily: string;
  fontWeight: number;
  /** Box each word's ink fills (contain-fit, centered), CSS px relative to the canvas. */
  box: Box;
  pitchRange: readonly [min: number, max: number];
}

export interface WordRaster {
  /** Ink coverage per cell, 0..255, row-major from the top-left cell. */
  coverage: Uint8Array;
  /** The word's signed distance field in cells, per cell (see sdf.ts): what a change melts. */
  shape: Float32Array;
  /** Where the word's ink landed, in CSS px; the box itself when nothing was drawn. */
  ink: Box;
}

/** Every word on one shared grid, so the field can change from one to the next cell by cell. */
export interface ArtRaster {
  layout: GridLayout;
  words: WordRaster[];
}

export interface ArtRasterizer {
  rasterize(width: number, height: number, spec: ArtSpec): ArtRaster;
}

/** Scratch pixels per cell edge; coverage is the box-filtered average of these samples. */
const SUPERSAMPLE = 4;
const REFERENCE_SIZE = 100;
/** Dots across the cap height of the set's smallest word, when the pitch range allows it. */
const CAP_ROWS = 14;
/** Cap height of the system faces, in em. */
const CAP_HEIGHT = 0.72;
/** Baseline to baseline for a word set on two lines, in em. */
const LINE_ADVANCE = 0.96;
/** A two-line layout must set the word this much larger to be worth the break. */
const BREAK_GAIN = 1.25;

/** Placement used until the host reports an art box. */
export function defaultArtBox(width: number, height: number): Box {
  return { x: width * 0.06, y: height * 0.12, width: width * 0.88, height: height * 0.5 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fontFor(spec: ArtSpec, size: number): string {
  return `${spec.fontWeight} ${size}px ${spec.fontFamily}`;
}

/** A word's layouts: on one line, and on two lines where it may break. */
function layouts(word: string): string[][] {
  const parts = word.split('|');
  return parts.length > 1 ? [[parts.join('')], parts] : [[word]];
}

interface Block {
  lines: string[];
  /** Font size in CSS px that fits the block into the box. */
  size: number;
}

/**
 * Rasterizes words at grid resolution: one coverage value per dot. Each word takes the layout (one
 * or two lines) that sets it largest in the box; the grid's pitch comes from the smallest of them,
 * so every word stays legible on the one grid. Canvas2D draws the text at SUPERSAMPLE x the grid;
 * reading the alpha channel avoids any color handling.
 */
export function createArtRasterizer(): ArtRasterizer | null {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  /** The block's ink extent at the reference size. */
  const measure = (spec: ArtSpec, lines: readonly string[]) => {
    ctx.font = fontFor(spec, REFERENCE_SIZE);
    const metrics = lines.map((line) => ctx.measureText(line));
    const width = Math.max(
      ...metrics.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight),
    );
    const first = metrics[0];
    const last = metrics[metrics.length - 1];
    const height =
      (first?.actualBoundingBoxAscent ?? 0) +
      (lines.length - 1) * LINE_ADVANCE * REFERENCE_SIZE +
      (last?.actualBoundingBoxDescent ?? 0);
    return { width, height };
  };

  const fit = (spec: ArtSpec, word: string): Block => {
    let best: Block = { lines: [word.replaceAll('|', '')], size: 0 };
    for (const lines of layouts(word)) {
      const { width, height } = measure(spec, lines);
      if (width <= 0 || height <= 0) continue;
      const size = REFERENCE_SIZE * Math.min(spec.box.width / width, spec.box.height / height);
      const gain = lines.length > 1 ? BREAK_GAIN : 1;
      if (size > best.size * gain) best = { lines, size };
    }
    return best;
  };

  return {
    rasterize(width, height, spec) {
      const blocks = spec.words.map((word) => fit(spec, word));
      const smallest = Math.min(...blocks.map((block) => block.size).filter((size) => size > 0));
      const [minPitch, maxPitch] = spec.pitchRange;
      const pitch = Number.isFinite(smallest)
        ? clamp((smallest * CAP_HEIGHT) / CAP_ROWS, minPitch, maxPitch)
        : maxPitch;
      const cols = Math.ceil(width / pitch) + 1;
      const rows = Math.ceil(height / pitch) + 1;
      const layout: GridLayout = {
        pitch,
        cols,
        rows,
        originX: (width - cols * pitch) / 2,
        originY: (height - rows * pitch) / 2,
      };

      const canvas = ctx.canvas;
      const scratchWidth = cols * SUPERSAMPLE;
      const scratchHeight = rows * SUPERSAMPLE;
      if (canvas.width !== scratchWidth || canvas.height !== scratchHeight) {
        canvas.width = scratchWidth;
        canvas.height = scratchHeight;
      }
      // k converts CSS px to scratch px.
      const k = SUPERSAMPLE / pitch;

      const drawWord = (block: Block): WordRaster => {
        const coverage = new Uint8Array(cols * rows);
        if (block.size <= 0) {
          return { coverage, shape: signedDistance(coverage, cols, rows), ink: spec.box };
        }
        ctx.clearRect(0, 0, scratchWidth, scratchHeight);
        // Resizing resets the context, so the font is set per word, after any resize.
        const size = block.size * k;
        ctx.font = fontFor(spec, size);
        const metrics = block.lines.map((line) => ctx.measureText(line));
        const ascent = metrics[0]?.actualBoundingBoxAscent ?? 0;
        const descent = metrics[metrics.length - 1]?.actualBoundingBoxDescent ?? 0;
        const blockHeight = ascent + (block.lines.length - 1) * LINE_ADVANCE * size + descent;
        const centerX = (spec.box.x + spec.box.width / 2 - layout.originX) * k;
        const centerY = (spec.box.y + spec.box.height / 2 - layout.originY) * k;
        let left = Infinity;
        let right = -Infinity;
        block.lines.forEach((line, index) => {
          const m = metrics[index];
          if (!m) return;
          const lineWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
          // Snap each line's ink edge and baseline to cell edges so stems land on whole dots.
          const inkLeft = Math.round((centerX - lineWidth / 2) / SUPERSAMPLE) * SUPERSAMPLE;
          const baseline =
            Math.round(
              (centerY - blockHeight / 2 + ascent + index * LINE_ADVANCE * size) / SUPERSAMPLE,
            ) * SUPERSAMPLE;
          ctx.fillText(line, inkLeft + m.actualBoundingBoxLeft, baseline);
          left = Math.min(left, inkLeft);
          right = Math.max(right, inkLeft + lineWidth);
        });
        const top = centerY - blockHeight / 2;
        const ink: Box = {
          x: layout.originX + left / k,
          y: layout.originY + top / k,
          width: (right - left) / k,
          height: blockHeight / k,
        };

        const pixels = ctx.getImageData(0, 0, scratchWidth, scratchHeight).data;
        const area = SUPERSAMPLE * SUPERSAMPLE;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            let sum = 0;
            for (let dy = 0; dy < SUPERSAMPLE; dy++) {
              let alpha = ((row * SUPERSAMPLE + dy) * scratchWidth + col * SUPERSAMPLE) * 4 + 3;
              for (let dx = 0; dx < SUPERSAMPLE; dx++, alpha += 4) sum += pixels[alpha] ?? 0;
            }
            coverage[row * cols + col] = Math.round(sum / area);
          }
        }
        return { coverage, shape: signedDistance(coverage, cols, rows), ink };
      };

      return { layout, words: blocks.map(drawWord) };
    },
  };
}
