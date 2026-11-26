/**
 * The entry has run its course by this, in seconds since the light came on: the last cells (the
 * farthest along the edge from the HUD, and the deepest) appear about 0.9 s in, their flash is
 * over by 1 s and the wash is full at 0.9 s. A frozen light may then stop drawing.
 */
export const GLYPH_ARRIVAL_SECONDS = 1.2;
/** How many recent agent clicks the light draws at once (`u_clicks`). */
export const GLYPH_MAX_CLICKS = 4;
/** A click's rewrite wave has faded by this, in seconds after the click; older clicks are unused. */
export const GLYPH_CLICK_SECONDS = 1.3;

/**
 * The glyph bitmaps: 5×5 rows from the top, `#` lit. Tiers run faint to dense (the brightness
 * picks the tier); each tier has 4 variants a cell mutates between.
 */
const GLYPHS: readonly (readonly string[])[] = [
  // Tier 0, faint marks: · : - ‥
  ['.....', '.....', '..#..', '.....', '.....'],
  ['.....', '..#..', '.....', '..#..', '.....'],
  ['.....', '.....', '.###.', '.....', '.....'],
  ['.....', '.....', '.#.#.', '.....', '.....'],
  // Tier 1, light strokes: + = / ×
  ['.....', '..#..', '.###.', '..#..', '.....'],
  ['.....', '.###.', '.....', '.###.', '.....'],
  ['....#', '...#.', '..#..', '.#...', '#....'],
  ['.....', '.#.#.', '..#..', '.#.#.', '.....'],
  // Tier 2, medium: 1 7 4 *
  ['..#..', '.##..', '..#..', '..#..', '.###.'],
  ['#####', '....#', '...#.', '..#..', '..#..'],
  ['#..#.', '#..#.', '#####', '...#.', '...#.'],
  ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'],
  // Tier 3, dense digits: 0 3 2 5
  ['.###.', '#...#', '#...#', '#...#', '.###.'],
  ['####.', '....#', '.###.', '....#', '####.'],
  ['####.', '....#', '.###.', '#....', '#####'],
  ['#####', '#....', '####.', '....#', '####.'],
  // Tier 4, heads: # ▣ ▚ 8
  ['.#.#.', '#####', '.#.#.', '#####', '.#.#.'],
  ['#####', '#...#', '#.#.#', '#...#', '#####'],
  ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'],
  ['.###.', '#...#', '.###.', '#...#', '.###.'],
];

/** Each glyph as a bit mask: bit (row × 5 + column) is set when that pixel is lit, row 0 on top. */
const GLYPH_BITS = GLYPHS.map((rows) => {
  let mask = 0;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') mask |= 1 << (r * 5 + c);
  });
  return mask;
});

/**
 * Glyph Stream (字形流), the tab's light: the edge as a dot-matrix band of tiny procedural 5×5
 * glyphs on a device-pixel grid. Streams flow from the top centre outward, rain down both sides and
 * sweep along the bottom; each head writes dense glyphs that mutate as it passes, carries a soft
 * light pool and decays back to faint dots. Glyph density follows activity; attention stops the
 * streams and lets the rail breathe amber, frozen holds every glyph still in the drained tones,
 * and Reduce Motion keeps only the rail, drifting slowly in brightness. Agent clicks send a brief
 * rewrite wave along the nearest edge (`u_clicks`); on entry, cells resolve outward along the edge
 * from the HUD's centre (`u_origin`), and nothing else of the HUD reaches the light.
 * It is the prototype's `glyph` option (`tmp/chrome-glow-prototypes/options/glyph.js`) at its
 * default tuning; canvasui.dev's Glyph Rain and ASCII Sweep inspired it, the GLSL is original.
 *
 * `vec4 glyphStream(vec2 p)` returns premultiplied light for device pixel `p` before strength; it
 * needs the uniforms, `hash` and the edge geometry `shader.ts` declares ahead of it.
 */
export const GLYPH_GLSL = `
const int GLYPHS[20] = int[20](${GLYPH_BITS.join(', ')});
// The prototype's default tuning: the cell and the glyph's stroke (CSS px), how many streams run,
// how fast, how long their tails are, and how deep the band reaches (fractions of the defaults).
const float GLYPH_CELL = 10.5;
const float GLYPH_DOT = 1.5;
const float GLYPH_DENSITY = 1.0;
const float GLYPH_SPEED = 1.0;
const float GLYPH_TAIL = 1.0;
const float GLYPH_DEPTH = 1.0;

// One stream lane (a depth row on one side): x = speed, y = period, z = phase offset (device px).
vec3 glyphLane(float lane, float side, float cellPx) {
  float seed = lane * 7.31 + side * 113.7;
  return vec3(
    cellPx * (4.0 + 6.0 * hash(vec2(seed, 1.7))) * GLYPH_SPEED,
    cellPx * (30.0 + 34.0 * hash(vec2(seed, 2.3))),
    hash(vec2(seed, 3.1)));
}

// Whether drop number id of a lane exists; deeper lanes carry fewer drops.
float glyphAlive(float lane, float side, float id, float cellPx, float reach) {
  float seed = lane * 7.31 + side * 113.7;
  float depth = lane * cellPx / reach;
  return step(hash(vec2(seed + 0.37, id)), GLYPH_DENSITY * 0.75 * (1.0 - smoothstep(0.0, 1.05, depth)));
}

// Soft light travelling with a lane's head at flow position f (pixel-continuous), 0..1.
float glyphHeadLight(float lane, float side, float f, float cellPx, float reach) {
  if (lane < 0.0) return 0.0;
  vec3 k = glyphLane(lane, side, cellPx);
  float x = k.x * u_phase - f + k.z * k.y;
  float id = floor(x / k.y);
  float b = x - id * k.y - 0.5 * cellPx;
  // Pixels ahead of a head belong to the next drop.
  float ahead = step(0.5 * k.y, b);
  b -= ahead * k.y;
  id += ahead;
  float depth = lane * cellPx / reach;
  float pool = exp(-b * b / (2.0 * 1.1 * 1.1 * cellPx * cellPx));
  float wake = step(0.0, b) * exp(-b / (cellPx * 3.5 * GLYPH_TAIL)) * 0.3;
  return glyphAlive(lane, side, id, cellPx, reach) * max(pool, wake) * (1.0 - 0.4 * depth);
}

vec4 glyphStream(vec2 p) {
  float cellPx = max(6.0, floor(GLYPH_CELL * u_dpr + 0.5));
  float pu = clamp(floor(GLYPH_DOT * u_dpr + 0.5), 1.0, floor(cellPx / 6.0));
  float reach = u_band * 0.75 * GLYPH_DEPTH;
  float dp = edgeDepth(p);
  if (dp > reach * 1.3 + cellPx) return vec4(0.0);

  // Grid centred on the canvas, so the partial-cell margins are equal on opposite edges.
  vec2 origin = floor(mod(u_res, cellPx) * 0.5);
  vec2 idx = floor((p - origin) / cellPx);
  vec2 c0 = origin + idx * cellPx;
  vec2 center = c0 + 0.5 * cellPx;
  float dc = edgeDepth(center);
  float depth = max(dc - 0.5 * cellPx, 0.0) / reach;
  float L = perimeterLength();
  float D = edgeFlow(center, L);
  float f = abs(D);
  float h0 = hash(idx * 1.37 + 11.0);
  float h1 = hash(idx.yx * 2.11 + 5.3);
  float calm = 1.0 - u_reduce;

  // Entry: cells resolve outward from the HUD along the edge, scrambling briefly as they appear.
  float shown = 1.0;
  float resolve = 0.0;
  if (u_entry > 0.5) {
    float fromHud = edgeWrap(D - edgeFlow(u_origin, L), L) / (0.5 * L);
    float age = u_since - (0.04 + 0.66 * fromHud + 0.1 * depth + 0.05 * h1);
    shown = step(0.0, age);
    // Only a thin front near the edge flashes; deeper cells just appear.
    resolve = shown * (1.0 - smoothstep(0.0, 0.16, age)) * step(h0, 1.0 - smoothstep(0.0, 0.7, depth));
  }

  // The faint wash the glyphs sit in, warmer and fuller when the band needs the person.
  float breath = 0.5 + 0.5 * sin(u_phase * 1.7 - f / L * 3.0);
  float washAmt = exp(-max(dp, 0.0) / (u_band * 0.2)) * (0.05 + u_attention * (0.12 + 0.2 * breath));
  washAmt *= mix(smoothstep(0.0, 0.9, u_since), 1.0, 1.0 - u_entry);

  // Rest: a dot-matrix rail, full at the edge and thinning toward the interior.
  float fall = 1.0 - smoothstep(0.0, 1.0, depth);
  float occupied = step(h0, fall * fall * 0.98);
  float rest = occupied * (0.05 + 0.13 * fall);
  // Attention brightens the rail in a slow breath, and Reduce Motion lets it drift very slowly;
  // both change brightness only, never the dots' shape.
  float drift = u_reduce * 0.3 * sin(u_phase * 0.35 + f * 0.0021 + h1 * 2.0);
  float lift = rest * (u_attention * (1.1 + 1.6 * breath) + drift);

  // Stream: one lane per depth row and side; heads travel along the flow at the lane's speed.
  float lane = floor(dc / cellPx);
  float side = D < 0.0 ? 0.0 : 1.0;
  vec3 lk = glyphLane(lane, side, cellPx);
  float x = lk.x * u_phase - f + lk.z * lk.y;
  float id = floor(x / lk.y);
  float behind = x - id * lk.y;
  float alive = glyphAlive(lane, side, id, cellPx, reach);
  float tailLen = cellPx * (1.1 + 2.2 * hash(vec2(id, lane + side * 13.0 + 9.1))) * GLYPH_TAIL;
  float trail = alive * exp(-max(behind - cellPx, 0.0) / tailLen);
  float head = alive * step(behind, cellPx);
  float flowing = (1.0 - u_attention) * calm;
  float stream = flowing * max(0.8 * trail, head) * (1.0 - 0.35 * depth) * (1.0 - 0.35 * u_frozen);

  // Agent clicks: a brief wavefront of rewritten glyphs runs both ways along the nearest edge.
  float burst = 0.0;
  for (int i = 0; i < ${GLYPH_MAX_CLICKS}; i++) {
    vec4 k = u_clicks[i];
    if (k.w < 0.5 || k.z > ${GLYPH_CLICK_SECONDS.toFixed(1)}) continue;
    float along = edgeWrap(D - edgeFlow(k.xy, L), L);
    float front = cellPx * (1.0 + 30.0 * k.z);
    float ring = exp(-pow((along - front) / (cellPx * 1.6), 2.0));
    burst = max(burst, ring * exp(-2.6 * k.z) * (1.0 - 0.5 * depth));
  }
  burst *= calm * (1.0 - u_attention);

  // Mutation: a cell rewrites itself a few times as a head passes (faster right behind it), then
  // slowly at rest; bursts and the entry scramble it.
  float churn = floor(h1 * 7.0);
  if (calm > 0.5) {
    churn = trail > 0.05 && flowing > 0.01
      ? 50.0 + id * 31.0 + floor(sqrt(behind / cellPx) * 2.2)
      : floor(u_phase * 0.1 + h1 * 7.0);
    if (burst > 0.12 || resolve > 0.0) churn += 300.0 + floor(u_since * 16.0);
  }

  float v = (rest + stream + 0.8 * burst) * (1.0 - 0.2 * u_frozen);
  v = max(v, resolve * (0.3 + 0.5 * h1)) * shown;
  float lum = clamp(v + lift * shown, 0.0, 1.0);

  // Light pools under the heads, continuous along the flow and across the two nearest lanes.
  float pool = 0.0;
  if (flowing > 0.01 && dp < reach * 1.2) {
    float Dp = edgeFlow(p, L);
    float u = dp / cellPx - 0.5;
    float l0 = floor(u);
    float sp = Dp < 0.0 ? 0.0 : 1.0;
    float w0 = exp(-(u - l0) * (u - l0) / 0.5);
    float w1 = exp(-(u - l0 - 1.0) * (u - l0 - 1.0) / 0.5);
    pool = w0 * glyphHeadLight(l0, sp, abs(Dp), cellPx, reach) + w1 * glyphHeadLight(l0 + 1.0, sp, abs(Dp), cellPx, reach);
    pool *= flowing * shown * (1.0 - 0.5 * u_frozen);
  }
  washAmt += pool * mix(0.1, 0.3, u_dark);
  vec3 washTone = mix(pow(u_tones[1], vec3(1.4)), mix(u_tones[1], u_tones[2], 0.4), u_dark);
  vec4 wash = vec4(washTone * washAmt, washAmt);
  vec2 local = p - c0;
  float margin = floor((cellPx - 5.0 * pu) * 0.5);
  vec2 gp = floor((local - margin) / pu);
  bool inBox = all(greaterThanEqual(gp, vec2(0.0))) && all(lessThan(gp, vec2(5.0)));
  bool inGrid = all(greaterThanEqual(c0, vec2(0.0))) && all(lessThanEqual(c0 + cellPx, u_res));
  if (!inBox || !inGrid || dc < 0.45 * cellPx || lum < 0.03) return wash;

  // Glyph: the tier follows brightness (faint dots to dense heads); the variant mutates.
  float tierF = clamp(v, 0.0, 1.0) * 4.7 + (hash(idx + churn * 1.31) - 0.5) * 0.8 * smoothstep(0.2, 0.45, v);
  int tier = int(clamp(floor(tierF), 0.0, 4.0));
  float hv = hash(idx * 0.73 + churn * 2.71 + 3.0);
  // At rest most faint cells are a plain dot; the other marks are occasional.
  int variant = tier == 0 ? (hv < 0.82 ? 0 : 1 + int(min(floor((hv - 0.82) * 16.7), 2.0)))
                          : int(min(floor(hv * 4.0), 3.0));
  int g = GLYPHS[tier * 4 + variant];
  int bit = int(4.0 - gp.y) * 5 + int(gp.x);
  if (((g >> bit) & 1) == 0) return wash;

  float hot = smoothstep(0.3, 0.95, lum);
  // Light page: saturated ink (the tones deepened), azure at rest to cobalt at the heads, so the
  // marks read as colour over white, not grey.
  vec3 inkRest = pow(u_tones[1], vec3(1.5));
  vec3 inkTail = pow(mix(u_tones[0], u_tones[1], 0.55), vec3(1.9));
  vec3 inkHead = pow(u_tones[1], vec3(2.6));
  vec3 ink = mix(mix(inkRest, inkTail, smoothstep(0.12, 0.45, lum)), inkHead, hot);
  float inkA = mix(0.4, 1.0, smoothstep(0.05, 0.6, lum));
  // Dark page: emissive, steel at rest rising to mist-white at the heads.
  vec3 glow = mix(u_tones[1] * 0.8, mix(u_tones[1], u_tones[2], 0.6) * 1.15, smoothstep(0.12, 0.5, lum));
  glow = mix(glow, u_tones[2] * 1.3, hot);
  float glowI = mix(0.32, 1.0, smoothstep(0.04, 0.7, lum));
  vec4 mark = mix(vec4(ink * inkA, inkA), vec4(glow * glowI, glowI), u_dark);
  return mark + wash * (1.0 - mark.a);
}
`;
