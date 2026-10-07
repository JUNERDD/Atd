import {
  CAP_HEIGHT,
  CAP_ROWS,
  CURSOR_MIN,
  CURSOR_SHARE,
  fitWords,
  fontFor,
  LINE_ADVANCE,
  type ArtSpec,
  type Block,
} from './art-fit';
import type { Box } from './types';

/** Dot grid geometry in CSS px. The grid is centered on the canvas and overhangs it by up to one cell. */
export interface GridLayout {
  pitch: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
}

export interface WordRaster {
  /** Ink coverage per cell, 0..255, row-major from the top-left cell. */
  coverage: Uint8Array;
  /**
   * Per cell, which character it belongs to, counting from 1 in typing order (0 for no ink), so a
   * word can show only its first few characters as it is typed.
   */
  order: Uint8Array;
  /** Where the word's ink landed, in CSS px; the box itself when nothing was drawn. */
  ink: Box;
  /**
   * The block cursor after each typed prefix, from none typed (at the first character's place) to
   * the whole word (at rest), in CSS px on whole cells: past the last typed character, as tall as
   * the capitals and standing on that line's baseline.
   */
  cursors: Box[];
}

/** A set line as typing walks it, in scratch px. */
interface TypedLine {
  chars: string[];
  /** Where the line's ink starts, and where fillText draws it from. */
  start: number;
  origin: number;
  /** Where each prefix's ink ends: after the first character, the first two, and so on. */
  ends: number[];
  baseline: number;
  ascent: number;
  descent: number;
  /** The word's character index the line starts at. */
  first: number;
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

/** Placement used until the host reports an art box. */
export function defaultArtBox(width: number, height: number): Box {
  return { x: width * 0.06, y: height * 0.12, width: width * 0.88, height: height * 0.5 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rasterizes words at grid resolution: one coverage value per dot, set as fitWords (art-fit.ts)
 * decides. The grid's pitch comes from the smallest word, so every word stays legible on the one
 * grid. Canvas2D draws the text at SUPERSAMPLE x the grid;
 * reading the alpha channel avoids any color handling.
 */
export function createArtRasterizer(): ArtRasterizer | null {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  return {
    rasterize(width, height, spec) {
      const blocks = fitWords(ctx, spec);
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
      const area = SUPERSAMPLE * SUPERSAMPLE;

      /** Averages the scratch canvas into per-cell coverage for rows [from, to). */
      const readCells = (from: number, to: number, into: Uint8Array): void => {
        const band = ctx.getImageData(
          0,
          from * SUPERSAMPLE,
          scratchWidth,
          (to - from) * SUPERSAMPLE,
        );
        for (let row = from; row < to; row++) {
          for (let col = 0; col < cols; col++) {
            let sum = 0;
            for (let dy = 0; dy < SUPERSAMPLE; dy++) {
              const y = (row - from) * SUPERSAMPLE + dy;
              let alpha = (y * scratchWidth + col * SUPERSAMPLE) * 4 + 3;
              for (let dx = 0; dx < SUPERSAMPLE; dx++, alpha += 4) sum += band.data[alpha] ?? 0;
            }
            into[row * cols + col] = Math.round(sum / area);
          }
        }
      };

      const drawWord = (block: Block): WordRaster => {
        const coverage = new Uint8Array(cols * rows);
        const order = new Uint8Array(cols * rows);
        if (block.size <= 0) {
          return { coverage, order, ink: spec.box, cursors: [{ x: 0, y: 0, width: 0, height: 0 }] };
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
        const capCells = (CAP_HEIGHT * size) / SUPERSAMPLE;
        const cursorCells = Math.max(CURSOR_MIN, Math.round(capCells * CURSOR_SHARE));
        // The word centers as one block with its cursor after the last line; its lines start at the
        // block's left edge, so a two-line word wraps to the start of its second line as it types.
        const blockSpan = Math.max(
          ...metrics.map(
            (m, index) =>
              m.actualBoundingBoxLeft +
              m.actualBoundingBoxRight +
              (index === metrics.length - 1 ? 2 * cursorCells * SUPERSAMPLE : 0),
          ),
        );
        const blockLeft = centerX - blockSpan / 2;
        let left = Infinity;
        let right = -Infinity;
        const lines: TypedLine[] = [];
        block.lines.forEach((line, index) => {
          const m = metrics[index];
          if (!m) return;
          const lineWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
          // Snap each line's ink edge and baseline to cell edges so stems land on whole dots.
          const inkLeft = Math.round(blockLeft / SUPERSAMPLE) * SUPERSAMPLE;
          const baseline =
            Math.round(
              (centerY - blockHeight / 2 + ascent + index * LINE_ADVANCE * size) / SUPERSAMPLE,
            ) * SUPERSAMPLE;
          const origin = inkLeft + m.actualBoundingBoxLeft;
          ctx.fillText(line, origin, baseline);
          left = Math.min(left, inkLeft);
          right = Math.max(right, inkLeft + lineWidth);
          const chars = Array.from(line);
          const ends = chars.map(
            (_, i) =>
              origin + ctx.measureText(chars.slice(0, i + 1).join('')).actualBoundingBoxRight,
          );
          const first = lines.reduce((sum, typed) => sum + typed.chars.length, 0);
          lines.push({
            chars,
            start: inkLeft,
            origin,
            ends,
            baseline,
            ascent: m.actualBoundingBoxAscent,
            descent: m.actualBoundingBoxDescent,
            first,
          });
        });
        const cursorAt = (line: TypedLine, edge: number, after: boolean): Box => {
          const col = after ? Math.ceil(edge / SUPERSAMPLE) + cursorCells : edge / SUPERSAMPLE;
          const baselineRow = line.baseline / SUPERSAMPLE;
          const capRow = Math.round(baselineRow - capCells);
          return {
            x: layout.originX + col * pitch,
            y: layout.originY + capRow * pitch,
            width: cursorCells * pitch,
            height: (baselineRow - capRow) * pitch,
          };
        };
        const cursors = lines.flatMap((line, index) => [
          ...(index === 0 ? [cursorAt(line, line.start, false)] : []),
          ...line.ends.map((end) => cursorAt(line, end, true)),
        ]);
        const top = centerY - blockHeight / 2;
        const ink: Box = {
          x: layout.originX + left / k,
          y: layout.originY + top / k,
          width: (right - left) / k,
          height: blockHeight / k,
        };

        readCells(0, rows, coverage);

        // Which character each dot belongs to: each line's prefixes are drawn in turn, and a dot goes
        // to the first prefix that inks at least half of it, so kerned and overhanging glyphs keep
        // their own dots. Anything left over shows with the last character.
        const prefix = new Uint8Array(cols * rows);
        const total = lines.reduce((sum, line) => sum + line.chars.length, 0);
        for (const line of lines) {
          const from = clamp(Math.floor((line.baseline - line.ascent) / SUPERSAMPLE) - 1, 0, rows);
          const to = clamp(Math.ceil((line.baseline + line.descent) / SUPERSAMPLE) + 1, 0, rows);
          line.chars.forEach((_, i) => {
            ctx.clearRect(0, 0, scratchWidth, scratchHeight);
            ctx.fillText(line.chars.slice(0, i + 1).join(''), line.origin, line.baseline);
            readCells(from, to, prefix);
            for (let cell = from * cols; cell < to * cols; cell++) {
              const full = coverage[cell] ?? 0;
              if (order[cell] === 0 && full > 0 && (prefix[cell] ?? 0) * 2 >= full) {
                order[cell] = line.first + i + 1;
              }
            }
          });
        }
        for (let cell = 0; cell < cols * rows; cell++) {
          if (order[cell] === 0 && (coverage[cell] ?? 0) > 0) order[cell] = total;
        }
        return { coverage, order, ink, cursors };
      };

      return { layout, words: blocks.map(drawWord) };
    },
  };
}
