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
  text: string;
  fontFamily: string;
  fontWeight: number;
  /** Box the art's ink fills (contain-fit, centered), CSS px relative to the canvas. */
  box: Box;
  pitchRange: readonly [min: number, max: number];
}

export interface ArtRaster {
  layout: GridLayout;
  /** Ink coverage per cell, 0..255, row-major from the top-left cell. */
  coverage: Uint8Array;
}

export interface ArtRasterizer {
  rasterize(width: number, height: number, spec: ArtSpec): ArtRaster;
}

/** Scratch pixels per cell edge; coverage is the box-filtered average of these samples. */
const SUPERSAMPLE = 4;
const REFERENCE_SIZE = 100;
/** Dots across the art's ink height, when the pitch range allows it. */
const TARGET_ROWS = 34;

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

/**
 * Rasterizes art text at grid resolution: one coverage value per dot. Canvas2D draws the text at
 * SUPERSAMPLE x the grid; reading the alpha channel avoids any color handling.
 */
export function createArtRasterizer(): ArtRasterizer | null {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let buffer = new Uint8Array(0);

  return {
    rasterize(width, height, spec) {
      ctx.font = fontFor(spec, REFERENCE_SIZE);
      const reference = ctx.measureText(spec.text);
      const inkWidth = reference.actualBoundingBoxLeft + reference.actualBoundingBoxRight;
      const inkHeight = reference.actualBoundingBoxAscent + reference.actualBoundingBoxDescent;
      const fit =
        inkWidth > 0 && inkHeight > 0
          ? Math.min(spec.box.width / inkWidth, spec.box.height / inkHeight)
          : 0;

      const [minPitch, maxPitch] = spec.pitchRange;
      const pitch = clamp((inkHeight * fit) / TARGET_ROWS, minPitch, maxPitch);
      const cols = Math.ceil(width / pitch) + 1;
      const rows = Math.ceil(height / pitch) + 1;
      const layout: GridLayout = {
        pitch,
        cols,
        rows,
        originX: (width - cols * pitch) / 2,
        originY: (height - rows * pitch) / 2,
      };
      if (buffer.length === cols * rows) buffer.fill(0);
      else buffer = new Uint8Array(cols * rows);
      if (fit <= 0) return { layout, coverage: buffer };

      const canvas = ctx.canvas;
      const scratchWidth = cols * SUPERSAMPLE;
      const scratchHeight = rows * SUPERSAMPLE;
      if (canvas.width !== scratchWidth || canvas.height !== scratchHeight) {
        canvas.width = scratchWidth;
        canvas.height = scratchHeight;
      } else {
        ctx.clearRect(0, 0, scratchWidth, scratchHeight);
      }

      // Resizing resets the context, so the font is set after it. k converts CSS px to scratch px.
      const k = SUPERSAMPLE / pitch;
      ctx.font = fontFor(spec, REFERENCE_SIZE * fit * k);
      const ink = ctx.measureText(spec.text);
      const centerX = (spec.box.x + spec.box.width / 2 - layout.originX) * k;
      const centerY = (spec.box.y + spec.box.height / 2 - layout.originY) * k;
      // Snap the ink's left edge and the baseline to cell edges so stems and feet land on whole dots.
      const inkLeft = centerX - (ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight) / 2;
      const baseline = centerY + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2;
      ctx.fillText(
        spec.text,
        Math.round(inkLeft / SUPERSAMPLE) * SUPERSAMPLE + ink.actualBoundingBoxLeft,
        Math.round(baseline / SUPERSAMPLE) * SUPERSAMPLE,
      );

      const pixels = ctx.getImageData(0, 0, scratchWidth, scratchHeight).data;
      const area = SUPERSAMPLE * SUPERSAMPLE;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          let sum = 0;
          for (let dy = 0; dy < SUPERSAMPLE; dy++) {
            let alpha = ((row * SUPERSAMPLE + dy) * scratchWidth + col * SUPERSAMPLE) * 4 + 3;
            for (let dx = 0; dx < SUPERSAMPLE; dx++, alpha += 4) sum += pixels[alpha] ?? 0;
          }
          buffer[row * cols + col] = Math.round(sum / area);
        }
      }
      return { layout, coverage: buffer };
    },
  };
}
