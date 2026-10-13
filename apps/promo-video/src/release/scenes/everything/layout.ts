/**
 * Where the mosaic lives, as data: the cell grid (five dots per cell, so the dot grid shows through
 * the gaps like grout), each tile's cells and family, the words' anchors in the digits' holes, and
 * the camera's shots. Pure: world frame px of the 1920 × 1080 container the camera looks at.
 *
 * The tiles sit on a 13 × 7 cell matrix that draws "0.8": each digit five cells wide (a rounded
 * "0" and "8" with open corners), the point one cell, one empty column either side of it. Strokes
 * are one cell thick; hero tiles span two cells along a stroke.
 */
import { springs, type Spring } from '../../../motion/spring.ts';
import type { Shot } from '../../../kit/world/camera.ts';
import { EIGHTH, EVERYTHING_BEATS as B, TILE_ARRIVALS, WORD_HITS, type TileId } from './beats.ts';

/** Cell pitch (five dots), the gap between tiles, and the matrix's top-left in world px. */
export const PITCH = 120;
export const GAP = 12;
export const ORIGIN = { x: 186, y: 114 } as const;
/** Content px per world px inside a tile: product surfaces are laid out at 3× and shrunk. */
export const DENSITY = 3;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a tile shows: one vignette family each. */
export type TileKind =
  | 'tasks'
  | 'apps'
  | 'pin'
  | 'automation'
  | 'memory'
  | 'skills'
  | 'subagents'
  | 'mcp'
  | 'capture'
  | 'file'
  | 'mini'
  | 'status'
  | 'brand'
  | 'chips'
  | 'island'
  | 'providers'
  | 'steps'
  | 'composer'
  | 'progress'
  | 'point';

/** What surface a tile's vignette sits on: plain ink, a desktop's glows, night, or the point's coral. */
export type Wall = 'ink' | 'desk' | 'night' | 'point';

/** Each family's surface. */
export const WALLS: Record<TileKind, Wall> = {
  tasks: 'ink',
  apps: 'desk',
  pin: 'desk',
  automation: 'night',
  memory: 'ink',
  skills: 'ink',
  subagents: 'ink',
  mcp: 'ink',
  capture: 'ink',
  file: 'ink',
  mini: 'desk',
  status: 'desk',
  brand: 'ink',
  chips: 'ink',
  island: 'desk',
  providers: 'ink',
  steps: 'ink',
  composer: 'desk',
  progress: 'ink',
  point: 'point',
};

export interface TileSpec {
  id: TileId;
  kind: TileKind;
  /** Column, row, and span in cells. */
  cell: readonly [number, number, number, number];
  rect: Rect;
  arrive: number;
  /** The index of the word this hero tile carries, if any. */
  word?: number;
  /** A brand tile's first mark, an index into the provider list. */
  brand?: number;
}

export function cellRect(column: number, row: number, wide = 1, tall = 1): Rect {
  return {
    x: ORIGIN.x + column * PITCH,
    y: ORIGIN.y + row * PITCH,
    width: wide * PITCH - GAP,
    height: tall * PITCH - GAP,
  };
}

export function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

type Entry = [TileId, TileKind, number, number, number, number, Partial<TileSpec>?];

/** The matrix, digit by digit. */
const ENTRIES: Entry[] = [
  // "0": top, left stroke, right stroke, bottom.
  ['pin', 'pin', 1, 0, 1, 1],
  ['apps', 'apps', 2, 0, 2, 1, { word: 1 }],
  ['tasks', 'tasks', 0, 1, 1, 2, { word: 0 }],
  ['file', 'file', 0, 3, 1, 1],
  ['mini', 'mini', 0, 4, 1, 2],
  ['status', 'status', 4, 1, 1, 1],
  ['automation', 'automation', 4, 2, 1, 2, { word: 2 }],
  ['brandA', 'brand', 4, 4, 1, 1, { brand: 0 }],
  ['chips', 'chips', 4, 5, 1, 1],
  ['memory', 'memory', 1, 6, 2, 1, { word: 3 }],
  ['brandB', 'brand', 3, 6, 1, 1, { brand: 3 }],
  // The point.
  ['point', 'point', 6, 6, 1, 1],
  // "8": top, upper strokes, waist, lower strokes, bottom.
  ['island', 'island', 9, 0, 1, 1],
  ['subagents', 'subagents', 10, 0, 2, 1, { word: 5 }],
  ['skills', 'skills', 8, 1, 1, 2, { word: 4 }],
  ['mcp', 'mcp', 12, 1, 1, 2, { word: 6 }],
  ['capture', 'capture', 9, 3, 2, 1, { word: 7 }],
  ['steps', 'steps', 11, 3, 1, 1],
  ['providers', 'providers', 8, 4, 1, 2],
  ['brandC', 'brand', 12, 4, 1, 1, { brand: 6 }],
  ['progress', 'progress', 12, 5, 1, 1],
  ['brandD', 'brand', 9, 6, 1, 1, { brand: 9 }],
  ['composer', 'composer', 10, 6, 2, 1],
];

export const TILES: readonly TileSpec[] = ENTRIES.map(([id, kind, c, r, w, h, extra]) => ({
  id,
  kind,
  cell: [c, r, w, h] as const,
  rect: cellRect(c, r, w, h),
  arrive: TILE_ARRIVALS[id],
  ...extra,
}));

/** The digits' bounds, for the glint and the converge order. */
export const DIGITS: Rect = cellRect(0, 0, 13, 7);

/** A word's anchor in a digit's hole: its baseline-ish center line and alignment. */
export interface WordAnchor {
  x: number;
  y: number;
  align: 'left' | 'right' | 'center';
}

/** Word i sits beside hero i, inside the "0"'s hole or one of the "8"'s. */
export const WORD_ANCHORS: readonly WordAnchor[] = [
  { x: 330, y: 348, align: 'left' },
  { x: 480, y: 330, align: 'center' },
  { x: 642, y: 468, align: 'right' },
  { x: 330, y: 762, align: 'left' },
  { x: 1290, y: 348, align: 'left' },
  { x: 1500, y: 300, align: 'center' },
  { x: 1602, y: 400, align: 'right' },
  { x: 1290, y: 690, align: 'left' },
];

/** Each hero shot's zoom: in close, easing out as the build gathers pace. */
const HERO_ZOOM = [2.9, 2.75, 2.65, 2.55, 2.5, 2.4, 2.3, 2.15];
/** How far the camera keeps creeping in while it holds on a hero. */
const CREEP = 1.045;

const WHIP: Spring = { response: 0.4, damping: 0.88 };
const DRIFT: Spring = { response: 1.6, damping: 1 };
const PULL: Spring = { response: 0.85, damping: 0.92 };

function heroFocus(index: number): { x: number; y: number } {
  const tile = TILES.find((spec) => spec.word === index);
  const anchor = WORD_ANCHORS[index]!;
  const hero = tile ? centerOf(tile.rect) : { x: anchor.x, y: anchor.y };
  // The word's visual center: anchors are an edge for left/right-aligned words.
  const shift = anchor.align === 'left' ? 110 : anchor.align === 'right' ? -110 : 0;
  return { x: (hero.x + anchor.x + shift) / 2, y: (hero.y + anchor.y) / 2 };
}

/**
 * The camera: at rest on frame 0, a slow dive toward the first hero during the lead line, a whip
 * an eighth before every word hit (with a creep while it holds), the pull back to the whole "0.8"
 * on bar 21, a slow ride out on the riser, and back to rest for the converge.
 */
export const SHOTS: readonly Shot[] = (() => {
  const first = heroFocus(0);
  const shots: Shot[] = [
    { at: 0, x: 960, y: 540, zoom: 1 },
    { at: B.dive, x: (first.x + 960) / 2, y: (first.y + 540) / 2, zoom: 1.45, spring: DRIFT },
  ];
  WORD_HITS.forEach((hit, index) => {
    const focus = heroFocus(index);
    const zoom = HERO_ZOOM[index]!;
    const at = index === 0 ? B.firstWhip : hit - EIGHTH;
    shots.push({ at, ...focus, zoom, spring: WHIP });
    shots.push({ at: hit + 0.1, ...focus, zoom: zoom * CREEP, spring: DRIFT });
  });
  shots.push({ at: B.pullback, x: 960, y: 540, zoom: 1, spring: PULL });
  shots.push({
    at: B.pullback + 0.7,
    x: 960,
    y: 546,
    zoom: 0.965,
    spring: { ...DRIFT, response: 2.2 },
  });
  shots.push({ at: B.morph, x: 960, y: 540, zoom: 1, spring: springs.snappy });
  return shots;
})();
