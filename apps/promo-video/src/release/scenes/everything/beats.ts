/**
 * The everything section's beats, in seconds from its start (bar 17 on the film's clock; the
 * section is bars 17–22, 40.8–52.8 s), on the eighth-note grid (0.3 s) the mosaic flips on. Pure
 * and DOM-free, so the score reads the same times (`atRelease('everything', t)` for film time).
 *
 * Bar 17: the lead line rises word by word on the eighths over the bare grid while the camera
 * dives into it. Bars 18–20: the dot grid becomes a mosaic of live tiles; eight hero tiles land on
 * a dotted-quarter pulse (every three eighths), each with its word, the camera whipping to each,
 * and fill tiles flip in on the eighths between. Bar 21: the camera pulls back and the tiles turn
 * out to spell "0.8"; the last tiles complete it, the decimal point lands, a completion glint
 * crosses it, the point rises and becomes the caret, and every tile converges into it, ending on
 * the finale's first frame at 12.0.
 */
import { bars, beats, steps } from '../../timeline.ts';

/** One eighth note: the mosaic's flip grid. */
export const EIGHTH = steps(2);

/** The eight word hits, three eighths apart from bar 18's downbeat (Tasks … Capture). */
export const WORD_HITS = [0, 3, 6, 9, 12, 15, 18, 21].map((n) => bars(1) + n * EIGHTH);

export const EVERYTHING_BEATS = {
  /** The lead line's words rise on the eighths (sound: a soft tick each). */
  lead: [steps(2), steps(4), steps(6), steps(8), steps(10)],
  /** The lead line leaves, rising out, as the first tiles seed (sound: a filtered swell begins). */
  leadOut: steps(13),
  /** The camera starts its slow dive into the grid. */
  dive: beats(1),
  /** The camera whips to the first hero tile (lands on the first word hit). */
  firstWhip: steps(13),
  /** Bar 21 downbeat: the camera pulls back and the tiles turn out to spell "0.8" (big hit, riser starts). */
  pullback: bars(4),
  /** The decimal point lands: "0.8" is complete (coral hit). */
  point: bars(4) + 3 * EIGHTH,
  /** A cool completion glint crosses the digits left to right (sound: a bright shimmer sweep). */
  glint: bars(4) + beats(1) + steps(1),
  glintLength: steps(3),
  /** The point rises from its tile and stretches into the caret (sound: a rising whoosh). */
  morph: bars(4) + steps(10),
  morphLength: steps(2),
  /** Every tile converges into the caret, nearest first (sound: a reversed swell into the hit). */
  converge: bars(4) + beats(3),
  /** The farthest tile is swallowed; the next frame is the finale's first (impact on its downbeat). */
  swallowed: bars(5) - steps(1) / 3,
  /** The section's end: the finale's downbeat HIT at 52.8 s. */
  end: bars(5),
} as const;

/**
 * Every tile's arrival (it flips open from a dot of the grid), in seconds, with a dot ripple under
 * it. Hero tiles land on their word hit; fills land on the eighths between. Sound: a short tick per
 * fill, a heavier flip on each hero (with the word).
 */
export const TILE_ARRIVALS = {
  file: WORD_HITS[0]! - EIGHTH,
  tasks: WORD_HITS[0]!,
  mini: WORD_HITS[0]! + EIGHTH,
  status: WORD_HITS[0]! + 2 * EIGHTH,
  apps: WORD_HITS[1]!,
  pin: WORD_HITS[1]! + EIGHTH,
  brandA: WORD_HITS[1]! + 2 * EIGHTH,
  automation: WORD_HITS[2]!,
  chips: WORD_HITS[2]! + EIGHTH,
  brandB: WORD_HITS[2]! + 2 * EIGHTH,
  memory: WORD_HITS[3]!,
  island: WORD_HITS[3]! + EIGHTH,
  skills: WORD_HITS[4]!,
  providers: WORD_HITS[4]! + EIGHTH,
  subagents: WORD_HITS[5]!,
  steps: WORD_HITS[5]! + EIGHTH,
  mcp: WORD_HITS[6]!,
  brandC: WORD_HITS[6]! + EIGHTH,
  capture: WORD_HITS[7]!,
  /** The last three tiles complete the "8" while the camera pulls back. */
  composer: bars(4),
  brandD: bars(4) + EIGHTH,
  progress: bars(4) + 2 * EIGHTH,
  /** The decimal point, last. */
  point: bars(4) + 3 * EIGHTH,
} as const;

export type TileId = keyof typeof TILE_ARRIVALS;

/**
 * Brand tiles turn over to the next provider's mark on these eighths, filling the eighths no tile
 * lands on (sound: a light flip tick). Each turn lasts a sixteenth either side of its time.
 */
export const BRAND_TURNS: Partial<Record<TileId, readonly number[]>> = {
  brandA: [WORD_HITS[3]! + 2 * EIGHTH, WORD_HITS[5]! + 2 * EIGHTH],
  brandB: [WORD_HITS[4]! + 2 * EIGHTH, WORD_HITS[6]! + 2 * EIGHTH],
  brandC: [WORD_HITS[7]! + EIGHTH],
  brandD: [bars(4) + 4 * EIGHTH],
};

/** Everything the score may want in one list: [time, cue] pairs, in order. */
export function everythingCues(): [number, string][] {
  const cues: [number, string][] = EVERYTHING_BEATS.lead.map((at) => [at, 'lead word']);
  cues.push([EVERYTHING_BEATS.leadOut, 'lead out']);
  for (const [id, at] of Object.entries(TILE_ARRIVALS)) cues.push([at, `tile ${id}`]);
  WORD_HITS.forEach((at, index) => cues.push([at, `word ${index}`]));
  for (const [id, turns] of Object.entries(BRAND_TURNS)) {
    for (const at of turns ?? []) cues.push([at, `turn ${id}`]);
  }
  const b = EVERYTHING_BEATS;
  cues.push([b.pullback, 'pullback'], [b.glint, 'glint'], [b.morph, 'morph']);
  cues.push([b.converge, 'converge'], [b.end, 'impact (finale downbeat)']);
  return cues.sort((x, y) => x[0] - y[0]);
}
