/**
 * The footer's afterglow: the app panel's waiting light (`apps/desktop`'s `waiting-glow/glow-field.ts`)
 * retold in the site's material. The panel blends a drifting 6×4 mesh of three colors; the site is
 * monochrome, so each mesh point carries only a brightness, the panel palette's luminance at the
 * same tone (`DEEP`, `STEEL`, `MIST`), and the light is seen only through the plate's LED holes
 * (`footer-glow.css`): lit dots, white in dark mode and black in light mode, which the page dims to
 * the hero backdrop's brightness (`--glow-level`), so the page closes on the quiet material it opens
 * on.
 * The mesh, its drift and displacement, and the falloff's shape keep the panel's values, so the
 * light moves as the panel's does. Three things change for the page: the crop widens with the
 * band and the mesh gains columns (`fieldScale`, `meshColumns`), so a page-wide band shows a drift
 * every few hundred pixels rather than one stretched middle; the dots' alpha takes a curve
 * (`DOT_GAMMA`), since a dim dot still reads as a dot; and the entrance is the site's, not the
 * panel's. The panel's bloom bursts from the composer to mark a sent chat; nothing is sent here, so
 * the light powers on as the hero's display does, coming up from the bottom edge patch by patch
 * at the field's own pace.
 *
 * The field is smooth, so it renders at one texel per `TEXEL` CSS px and the compositor scales the
 * canvas up; the dots come from the static perforated sheet over it. The drawing buffer is a few
 * kilobytes at any width and pixel ratio, and a frame shades one or two thousand texels.
 */

/** CSS px per field texel: well under the field's smallest feature, several LED dots wide. */
export const TEXEL = 16;

/** The panel's light runs at 30 frames a second; its slow motion needs no more once it is in. */
export const FRAME_MS = 1000 / 30;

/**
 * The power-on has settled by this many seconds: the last patch of the band starts at
 * `WAKE_RISE + WAKE_JITTER` and takes `WAKE_FADE` to come up (`GLOW_SHADER`).
 */
export const WAKE_SECONDS = 1.6;

/** Wake clock value that means "settled" to the shader: the light is fully on. */
export const WAKE_SETTLED = 1e4;

export type GlowTheme = 'light' | 'dark';

/**
 * Lit dot color per appearance: the site's lit dot (`--dot-1`; `dot/lit` in the design file). Both
 * appearances light at full strength here; the page sets the peak in CSS (`--glow-level`).
 */
export const GLOW_DOTS: Record<GlowTheme, readonly [number, number, number]> = {
  dark: [1, 1, 1],
  light: [0, 0, 0],
};

/**
 * The dark panel palette's deep, steel and mist as brightness (their luminance, mist taken as
 * full). Without hue, these steps are all that shows the light moving: the near-dark gaps between
 * the bright drifts are what make it read as flowing.
 */
const DEEP = 0.13;
const STEEL = 0.61;
const MIST = 1;

/** The panel shows its mesh 2.2 times the size of its box, through a drifting crop. */
const FIELD_SCALE = 2.2;
/** The panel's light band is about this wide for its height. */
const PANEL_ASPECT = 1.4;
/** The widest crop: most of the mesh's width, leaving room for the drift. */
const MIN_FIELD_SCALE = 1.15;
/** Vertically the falloff leaves the lower rows; a tighter crop reaches their brighter extremes. */
const FIELD_SCALE_Y = 1.8;

/** The panel's mesh is 6 × 4; a wider band extends it sideways, up to `MAX_COLUMNS`. */
const PANEL_COLUMNS = 6;
const ROWS = 4;
export const MAX_COLUMNS = 12;

/**
 * How many times the box the mesh is drawn, per axis. A box shaped like the panel's band sees the
 * panel's crop; the footer's band is several times wider for its height, so it sees most of the
 * mesh's width instead of one stretched middle. Written into `out` (x, y): a frame allocates
 * nothing.
 */
export function fieldScale(width: number, height: number, out: Float32Array): Float32Array {
  const aspect = height > 0 ? width / height : PANEL_ASPECT;
  out[0] = Math.min(FIELD_SCALE, Math.max(MIN_FIELD_SCALE, (FIELD_SCALE * PANEL_ASPECT) / aspect));
  out[1] = FIELD_SCALE_Y;
  return out;
}

/**
 * The mesh's columns for the box: the panel's six up to a band about four times wider than it is
 * tall, then one more per further box height or so. Six columns stretched across a wide screen
 * leave two or three drifts so broad the light reads as a flat floor; extra columns keep a drift
 * every few hundred pixels at any width.
 */
export function meshColumns(width: number, height: number): number {
  const aspect = height > 0 ? width / height : PANEL_ASPECT;
  return Math.min(MAX_COLUMNS, Math.max(PANEL_COLUMNS, Math.round(aspect * 0.9) + 2));
}

type Basis = readonly [number, number, number];

function rawBasis(x: number, y: number): Basis {
  return [
    Math.cos(Math.PI * x) * Math.cos(Math.PI * (y - 0.25)),
    Math.cos(Math.PI * y) * Math.cos(Math.PI * (x - 0.35)),
    0.6 * Math.cos(2 * Math.PI * x) * Math.sin(Math.PI * y) +
      0.4 * Math.sin(Math.PI * x) * Math.cos(Math.PI * (y + 0.2)),
  ];
}

/**
 * Three unrelated smooth fields sampled on the mesh's rest grid, centered and normalized per
 * channel over the panel's 6 × 4 grid, as the panel's (and the shell's `colorBases`). The light is
 * a moving blend of these. Further columns sample the same fields beyond the panel's edge at the
 * same spacing; over that next stretch most of each field changes sign, so they continue the
 * light with new drifts rather than repeating it. Row by row, `MAX_COLUMNS` per row.
 */
function meshBases(): Basis[] {
  const panel = Array.from({ length: PANEL_COLUMNS * ROWS }, (_, index) =>
    rawBasis((index % PANEL_COLUMNS) / 5, Math.floor(index / PANEL_COLUMNS) / 3),
  );
  const per = (fold: (channel: 0 | 1 | 2) => number): Basis => [fold(0), fold(1), fold(2)];
  const mean = per((c) => panel.reduce((sum, s) => sum + s[c], 0) / panel.length);
  const scale = per((c) => panel.reduce((max, s) => Math.max(max, Math.abs(s[c] - mean[c])), 0));
  return Array.from({ length: MAX_COLUMNS * ROWS }, (_, index) => {
    const s = rawBasis((index % MAX_COLUMNS) / 5, Math.floor(index / MAX_COLUMNS) / 3);
    return per((c) => (s[c] - mean[c]) / scale[c]);
  });
}

const BASES = meshBases();
const values = new Float64Array(MAX_COLUMNS * ROWS);

/**
 * Writes the mesh brightnesses at `phase` into `out`, row by row, `columns` per row. They depend
 * on time alone, so they are calculated once per frame, not per texel; nothing is allocated.
 */
export function meshLevels(phase: number, columns: number, out: Float32Array): Float32Array {
  const theta = 0.35 + 2.4 * Math.sin(0.66 * phase) + 0.6 * Math.sin(0.37 * phase + 0.8);
  const phi = 0.25 + 0.55 * Math.sin(0.61 * phase + 1.6);
  const w0 = Math.cos(theta) * Math.cos(phi);
  const w1 = Math.sin(theta) * Math.cos(phi);
  const w2 = Math.sin(phi);
  const count = columns * ROWS;
  for (let i = 0; i < count; i++) {
    const [b0, b1, b2] = BASES[Math.floor(i / columns) * MAX_COLUMNS + (i % columns)] ?? [0, 0, 0];
    values[i] = 0.65 * (b0 * w0 + b1 * w1 + b2 * w2);
  }
  // Each point eases a little toward its neighbours' mean, as the shell's smoothed mesh does.
  let total = 0;
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / columns);
    const column = i % columns;
    const value = values[i] ?? 0;
    const left = column > 0 ? (values[i - 1] ?? 0) : 0;
    const right = column < columns - 1 ? (values[i + 1] ?? 0) : 0;
    const above = row > 0 ? (values[i - columns] ?? 0) : 0;
    const below = row < ROWS - 1 ? (values[i + columns] ?? 0) : 0;
    const neighbours =
      Number(column > 0) + Number(column < columns - 1) + Number(row > 0) + Number(row < ROWS - 1);
    const sum = value + left + right + above + below;
    const softened = value + (sum / (neighbours + 1) - value) * ((0.5 / 1.5) * 0.32);
    out[i] = softened;
    total += softened;
  }
  const mean = total / count;
  for (let i = 0; i < count; i++) {
    const tone = 0.5 + 0.47 * Math.tanh(1.7 * ((out[i] ?? 0) - mean));
    out[i] = (1 - tone) ** 2 * DEEP + 2 * tone * (1 - tone) * STEEL + tone ** 2 * MIST;
  }
  return out;
}

/**
 * One pass draws the field into the small drawing buffer. Positions are in the glow box's units
 * from its bottom left, so the power-on keeps its pace at any size. The output is premultiplied:
 * the lit dot color times the light's alpha.
 */
export const GLOW_SHADER = `#version 300 es
precision highp float;

uniform vec2 u_res;        // drawing buffer, texels
uniform float u_phase;     // field time
uniform float u_wake;      // seconds since the power-on began; WAKE_SETTLED once it is on
uniform float u_mesh[48];  // brightness per mesh point (meshLevels), u_columns per row
uniform int u_columns;     // the mesh's columns (meshColumns), 6 to 12
uniform vec3 u_dot;        // lit dot color
uniform vec2 u_scale;      // the mesh's size in boxes, per axis (fieldScale)

out vec4 fragColor;

const float PI = 3.14159265;
// The panel's drift, which moves the crop up to 0.144 of the box either way.
const float DRIFT = 0.144;
// Power-on, in seconds (WAKE_SECONDS covers it), after the hero's display wake: the light comes up
// from the bottom edge, the front reaching the top of the band after WAKE_RISE. Each texel (a patch
// of two or three dots) waits a little longer or shorter (WAKE_JITTER), so the front is soft and
// ragged rather than a ruled line, then eases up from dark over WAKE_FADE, catching a little bright
// (WAKE_CATCH) as the front passes, as the site's LEDs do.
const float WAKE_RISE = 0.85;
const float WAKE_JITTER = 0.2;
const float WAKE_FADE = 0.55;
const float WAKE_CATCH = 0.35;
// The bottom share of the box at full strength; above it the light falls off to nothing.
const float SOLID = 0.2;
const float FALLOFF_POWER = 0.7;
// Dots read their alpha far more evenly than a wash does: a dim dot is still a visible dot, so a
// linear light turns the band into a flat screen. This curve lets the dim drifts and the tail go
// dark and keeps the bright drifts, so the light reads as light moving, not as a texture. The page
// shows the light at the hero backdrop's level (--glow-level), so the curve stays gentle: a
// steeper one sinks the drifts' middle tones below what that level can show.
const float DOT_GAMMA = 1.4;

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float catmullRom(float a, float b, float c, float d, float t) {
  float t2 = t * t;
  return 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2
    + (3.0 * b - a - 3.0 * c + d) * t2 * t);
}

// A stable value in [0, 1) per texel.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float mesh(int row, int column) {
  return u_mesh[clamp(row, 0, 3) * u_columns + clamp(column, 0, u_columns - 1)];
}

void main() {
  vec2 box = gl_FragCoord.xy / u_res;

  // This texel on the larger, drifting field (y down, as the panel lays the mesh out).
  vec2 uv = vec2(box.x, 1.0 - box.y);
  vec2 center = vec2(0.5 + DRIFT * sin(u_phase * 0.39), 0.5 + DRIFT * cos(u_phase * 0.31 + 1.2));
  uv = (uv - center) / u_scale + 0.5;

  // Undo the interior points' displacement, which follows one smooth field.
  float x = clamp(uv.x, 0.0, 1.0);
  float y = clamp(uv.y, 0.0, 1.0);
  float envelope = sin(PI * x) * sin(PI * y);
  float dx = 0.03 * envelope
    * (0.7 * sin(0.88 * u_phase + 2.2 * y) + 0.3 * sin(0.53 * u_phase + 2.6 * x + 0.4));
  float dy = 0.06 * envelope
    * (0.7 * cos(0.74 * u_phase + 2.4 * x) + 0.3 * sin(1.07 * u_phase + 1.8 * y));
  float spans = float(u_columns - 1);
  vec2 grid = clamp(uv - vec2(dx, dy), 0.0, 1.0) * vec2(spans, 3.0);
  int column = int(min(floor(grid.x), spans - 1.0));
  int row = int(min(floor(grid.y), 2.0));
  vec2 f = grid - vec2(float(column), float(row));
  float rows[4];
  for (int k = 0; k < 4; k++) {
    int r = row - 1 + k;
    rows[k] = catmullRom(
      mesh(r, column - 1), mesh(r, column), mesh(r, column + 1), mesh(r, column + 2), f.x);
  }
  float light = clamp(catmullRom(rows[0], rows[1], rows[2], rows[3], f.y), 0.0, 1.0);

  // Power-on: this texel's own clock, set by its height with a little jitter.
  float wake = 1.0;
  if (u_wake < 100.0) {
    float at = WAKE_RISE * box.y + WAKE_JITTER * hash(floor(gl_FragCoord.xy));
    float t = clamp((u_wake - at) / WAKE_FADE, 0.0, 1.0);
    wake = t * t * (3.0 - 2.0 * t) + WAKE_CATCH * sin(PI * t) * t;
  }

  // Smootherstep's slope is zero at both ends, so the light thins into the plate with no line.
  float falloff = pow(max(1.0 - smootherstep(SOLID, 1.0, box.y), 0.0), FALLOFF_POWER);
  float alpha = pow(clamp(light * falloff * wake, 0.0, 1.0), DOT_GAMMA);
  fragColor = vec4(u_dot * alpha, alpha);
}
`;
