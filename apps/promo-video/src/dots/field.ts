/**
 * Draws one frame of the LED display: a field of faint dots that twinkle, with a slow scanline band,
 * and the word lit in full dots. Power-on wakes the field outward from the word as a soft wave and
 * then lights the word left to right, each dot swelling with a small flash. The timings and radii
 * are the website hero's shader (apps/website/src/gl/shaders.ts), drawn with Canvas2D here so every
 * frame is a pure function of its state.
 */
import type { FieldRaster } from './raster.ts';
import { CURSOR_BLINK } from './typing.ts';

export interface FieldState {
  /** Seconds on the display's clock: drives the twinkle and the scanline band. */
  time: number;
  /** Seconds since power-on; large once settled. */
  boot: number;
  /** The word on the board, and how many of its characters show. */
  word: number;
  shown: number;
  /** Words are being erased or typed, so the cursor holds steady. */
  typing: boolean;
  /** Seconds since the shown word landed; negative before. The cursor blinks while it rests. */
  settle: number;
  /** Whether the block cursor may show: off hands it to the screen it opens into. */
  cursor: 'blink' | 'steady' | 'off';
  /** 0–1: the word's dots go dark in scattered order. */
  dissolve: number;
  /** The unlit field's level, 0.13 at rest. */
  field: number;
  /** A lit dot's level before its flash. */
  art: number;
}

const TAU = Math.PI * 2;
const WAKE_TIME = 0.7;
const WAKE_FADE = 0.5;
const WORD_START = 0.12;
const WORD_SWEEP = 0.72;
const WORD_GROW = 0.55;
const FIELD_RADIUS = 0.19;
const ART_RADIUS = 0.34;
const LEVELS = 96;

function smooth(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const randomsCache = new WeakMap<FieldRaster, Float32Array>();

/** Four steady 0–1 rolls per cell: the twinkle's phase and rate, the sweep's jitter, the dissolve's order. */
function randomsFor(raster: FieldRaster): Float32Array {
  const cached = randomsCache.get(raster);
  if (cached) return cached;
  const { cols, rows } = raster.grid;
  const values = new Float32Array(cols * rows * 4);
  for (let i = 0; i < values.length; i++) {
    let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
    h ^= h >>> 13;
    values[i] = (h >>> 0) / 4294967296;
  }
  randomsCache.set(raster, values);
  return values;
}

export function drawField(
  ctx: CanvasRenderingContext2D,
  raster: FieldRaster,
  state: FieldState,
  width: number,
  height: number,
): void {
  const { grid } = raster;
  const word = raster.words[state.word];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (!word) return;

  const randoms = randomsFor(raster);
  const paths = Array.from({ length: LEVELS }, () => new Path2D());
  const used = new Uint8Array(LEVELS);
  const { pitch, cols, rows, originX, originY } = grid;
  const ink = word.ink;
  const artCenterX = ink.x + ink.width / 2;
  const artCenterY = ink.y + ink.height / 2;
  const far = Math.hypot(
    Math.max(artCenterX, width - artCenterX),
    Math.max(artCenterY, height - artCenterY),
  );
  const cursor = word.cursors[Math.min(state.shown, word.cursors.length - 1)];
  const blinkOn = state.settle >= 0 && state.settle % (2 * CURSOR_BLINK) < CURSOR_BLINK;
  const cursorLit =
    state.cursor === 'steady' || (state.cursor === 'blink' && (state.typing || blinkOn)) ? 1 : 0;
  const band = ((state.time / 7) % 1) * 1.5 - 0.25;
  const dissolve = state.dissolve * 0.7;

  for (let row = 0; row < rows; row++) {
    const cy = originY + (row + 0.5) * pitch;
    const scanOffset = (cy / height - band) * 8;
    const scan = Math.exp(-scanOffset * scanOffset);
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      const cx = originX + (col + 0.5) * pitch;
      const r1x = randoms[cell * 4] ?? 0;
      const r1y = randoms[cell * 4 + 1] ?? 0;
      const r2x = randoms[cell * 4 + 2] ?? 0;
      const r2y = randoms[cell * 4 + 3] ?? 0;

      // Power-on: each dot eases up on its own clock, set by its distance from the word.
      const wakeAt = (WAKE_TIME * Math.hypot(cx - artCenterX, cy - artCenterY)) / far + 0.12 * r1y;
      const wakeRaw = Math.min(1, Math.max(0, (state.boot - wakeAt) / WAKE_FADE));
      const wakeGlow = Math.sin(Math.PI * wakeRaw) * 0.14;
      const wake = wakeRaw * wakeRaw * (3 - 2 * wakeRaw);

      // The word, only as far as it is typed, lit left to right with a ragged front.
      const typed = (word.order[cell] ?? 0) <= state.shown ? 1 : 0;
      const inArt = smooth(0.32, 0.68, (word.coverage[cell] ?? 0) / 255) * typed;
      let lit = 0;
      let flash = 0;
      if (inArt > 0) {
        const artX = Math.min(1, Math.max(0, (cx - ink.x) / Math.max(ink.width, 1)));
        const lockAt = WORD_START + WORD_SWEEP * (artX * 0.85 + 0.15 * r2x);
        const grow = Math.min(1, Math.max(0, (state.boot - lockAt) / WORD_GROW));
        const artOn = 1 - (1 - grow) ** 3;
        flash = Math.sin(Math.PI * grow) * 0.3;
        const order = r2y * 0.62;
        const keep = 1 - smooth(order, order + 0.08, dissolve);
        lit = inArt * artOn * keep;
      }
      if (
        cursorLit &&
        cursor &&
        cx >= cursor.x &&
        cx <= cursor.x + cursor.width &&
        cy >= cursor.y &&
        cy <= cursor.y + cursor.height
      ) {
        lit = 1;
        flash = 0;
      }

      const twinkle = 1 + 0.3 * Math.sin(state.time * (0.4 + 1.3 * r1y) + TAU * r1x);
      const field = state.field * (0.75 + 0.5 * r1x) * twinkle * (1 + 1.1 * scan) * wake;
      const nx = (cx / width) * 2 - 1;
      const ny = (cy / height) * 2 - 1;
      const vignette = 1 - 0.2 * smooth(0.6, 1.6, nx * nx + ny * ny);
      const base = field + wakeGlow * (state.field / 0.13);
      const level = (base + (state.art * (1 + flash) - base) * lit) * vignette;
      if (level < 0.006) continue;
      const radius = pitch * (FIELD_RADIUS * (0.55 + 0.45 * wake) * (1 - lit) + ART_RADIUS * lit);
      const bucket = Math.min(LEVELS - 1, Math.round(Math.min(1, level) * (LEVELS - 1)));
      const path = paths[bucket];
      if (!path) continue;
      path.moveTo(cx + radius, cy);
      path.arc(cx, cy, radius, 0, TAU);
      used[bucket] = 1;
    }
  }

  for (let bucket = 1; bucket < LEVELS; bucket++) {
    const path = paths[bucket];
    if (!used[bucket] || !path) continue;
    ctx.fillStyle = `rgb(255 255 255 / ${bucket / (LEVELS - 1)})`;
    ctx.fill(path);
  }
}
