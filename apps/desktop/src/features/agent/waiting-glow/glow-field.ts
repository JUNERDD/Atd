/**
 * The command HUD's flowing light (`IslandGlowField.swift` in the macOS shell) as a fragment shader
 * for Paper's `ShaderMount`, so the panel's wait for a reply shows the same field. The values below
 * mirror the shell's `IslandGlowField` and `IslandGlowStyle`; change both sides together.
 *
 * The shell draws a 6×4 `MeshGradient` with smoothed colors, 2.2 times the size of its box, and
 * shows a drifting crop of it so the field's edges never become the box's edges. Here a fragment
 * finds its place on that mesh (undoing the points' small displacement to first order) and blends
 * the 4×4 nearest colors with a Catmull-Rom spline, which stands in for `smoothsColors`. Every
 * value is a function of the time alone, so Paper's clock is the only input that moves.
 *
 * The panel's entry is drawn here too rather than by a CSS mask or transform: the canvas redraws
 * every frame the field moves, so the entry moves with it on any compositing path. With `u_entry`
 * on, the light blooms out of the composer (`u_origin`, in the box's units from its bottom left):
 * an ellipse wider than it is tall whose radius follows a critically damped spring (`ENTRY_SPRING`
 * per second), starting at rest and settling without overshoot, behind a soft rim that breathes
 * while it travels and calms as it arrives. Meanwhile the field gathers: its time runs ahead of the
 * clock at the send (about five times its pace) and eases back to it, so the light is moving as it
 * arrives instead of being uncovered. The bloom's coverage is the output's (premultiplied) alpha.
 * With `u_entry` off (Reduce Motion) the light is in from the start and keeps the clock's pace.
 *
 * The light's top is drawn here as well: a smootherstep falloff from `SOLID` to the box's top
 * edge, multiplied into the coverage. A linear ramp's slope jumps where it starts and where it
 * ends, and the eye reads each jump as a line (a Mach band); smootherstep's slope and curvature
 * are zero at both ends, so the light thins into the panel with no visible boundary. Raised to
 * `FALLOFF_POWER`, it holds more light through the middle and lets the faint tail reach higher,
 * so the top is wide and gentle while it still ends at zero with zero slope.
 *
 * A smooth falloff still bands: across its height the panel shows only a few dozen 8-bit levels
 * of the light (three of blue in light mode), and each step between them reads as a line. The
 * shader therefore draws the light at its final strength (`u_level`), so the canvas holds the
 * values the compositor shows, and adds a step of triangular noise to every channel there, which
 * leaves no rounding error that follows the gradient. Dithering before a CSS opacity would not do:
 * the opacity scales the noise down with the light (to 0.15 of a step in light mode) and the bands
 * return. The canvas also renders at the display's resolution (`waiting-glow.tsx`), since scaling
 * it up would smooth the noise away. CSS opacity carries only the fades, during which the bands
 * briefly return.
 */

/**
 * The light's bloom, exit and cyan-shift timing, in seconds. The exit, quick fade and cyan shift
 * match `waiting-glow.css` and the shell. The panel's entry blooms out of the composer, with a
 * shorter opacity fade; the shell's 0.4 fade relies on the HUD window's own entrance.
 */
export const GLOW_TIMING = {
  /**
   * The bloom has all but settled by this (99.4% of the spring). Opacity rises in 200 ms so the
   * light is already visible while the welcome and submitted draft leave.
   */
  entry: 0.8,
  /** The fade however the wait ends: after the reply's first output, or stopped or failed. */
  exit: 0.85,
  /** Every fade under Reduce Motion. */
  quick: 0.2,
  /** The cyan shift that marks the first output, before the light fades. */
  hue: 0.45,
} as const;

/**
 * The light's strength, as the shell's `IslandWorkingGlow` computes the HUD's: per appearance,
 * then reduced under Increase Contrast and Reduce Transparency. The shell's 0.34 in dark suits the
 * HUD's small capsule; over the whole dark panel its deep palette all but vanishes, so the panel's
 * band takes more of it.
 */
export const GLOW_STRENGTH = {
  light: 0.15,
  dark: 0.6,
  increasedContrast: 0.4,
  reducedTransparency: 0.6,
} as const;

export const GLOW_SHADER = `#version 300 es
precision highp float;

uniform float u_elapsed;
uniform float u_phase;
// The visible band may shrink inside an unchanged drawing buffer.
uniform float u_bandRatio;
// The soft upper edge recedes toward the composer before the remaining base fades.
uniform float u_retreat;
uniform float u_retreatTarget;
// Paper's vertex shader declares it at medium precision; the two declarations must match.
uniform mediump vec2 u_resolution;
// Calculated once per draw in glow-colors.ts.
uniform vec3 u_colors[24];
// 1 while the light enters (the bloom and the field gathering); 0 when it is in from the start.
uniform float u_entry;
// Where the bloom starts: the composer's centre, in the box's units from its bottom left.
uniform vec2 u_origin;
// The light's strength (\`glowLevel\`), drawn here so the dither below lands at the final values.
uniform float u_level;

out vec4 fragColor;

const float PI = 3.14159265;
const float FIELD_SCALE = 2.2;
// The bloom's spring, per second: critically damped, so it starts at rest and never overshoots.
const float ENTRY_SPRING = 9.0;
// The bloom spreads this much wider than it rises.
const float BLOOM_ASPECT = 1.6;
// The bloom's soft rim and the radius it settles at, in units of the box's width.
const float BLOOM_EDGE = 0.5;
const float BLOOM_REACH = 1.3;
// The bottom share of the box (behind the composer) at full strength; above it the light falls off.
const float SOLID = 0.2;
// The falloff's power: below 1 it keeps more light through the middle and stretches the faint tail
// higher, so the top is wider and gentler; the curve still ends at zero with zero slope.
const float FALLOFF_POWER = 0.7;

// Smootherstep: 0 to 1 between the edges with zero slope and zero curvature at both ends, so a
// falloff built on it has no kink where it starts or ends for the eye to read as a line.
float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// A uniform hash of the pixel without trigonometry, whose precision varies across GPUs.
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Triangular noise in -1..1 (two uniform hashes): its error no longer follows the signal.
float tpdf(vec2 p) {
  return hash(p) + hash(p + vec2(57.0, 113.0)) - 1.0;
}
vec3 catmullRom(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2
    + (3.0 * b - a - 3.0 * c + d) * t3);
}

void main() {
  vec2 resolution = vec2(u_resolution.x, u_resolution.y * u_bandRatio);
  if (gl_FragCoord.y > resolution.y) { fragColor = vec4(0.0); return; }
  float since = u_elapsed;
  float phase = u_phase;

  // This pixel on the larger, drifting field (y down, as the shell lays the mesh out).
  vec2 uv = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution;
  float drift = (FIELD_SCALE - 1.0) * 0.12;
  vec2 center = vec2(0.5 + drift * sin(phase * 0.39), 0.5 + drift * cos(phase * 0.31 + 1.2));
  uv = (uv - center) / FIELD_SCALE + 0.5;

  // Undo the interior points' displacement, which follows one smooth field.
  float x = clamp(uv.x, 0.0, 1.0);
  float y = clamp(uv.y, 0.0, 1.0);
  float envelope = sin(PI * x) * sin(PI * y);
  float dx = 0.03 * envelope
    * (0.7 * sin(0.88 * phase + 2.2 * y) + 0.3 * sin(0.53 * phase + 2.6 * x + 0.4));
  float dy = 0.06 * envelope
    * (0.7 * cos(0.74 * phase + 2.4 * x) + 0.3 * sin(1.07 * phase + 1.8 * y));
  vec2 grid = clamp(uv - vec2(dx, dy), 0.0, 1.0) * vec2(5.0, 3.0);
  int column = int(min(floor(grid.x), 4.0));
  int row = int(min(floor(grid.y), 2.0));
  vec2 f = grid - vec2(float(column), float(row));

  vec3 rows[4];
  for (int k = 0; k < 4; k++) {
    int r = clamp(row - 1 + k, 0, 3) * 6;
    rows[k] = catmullRom(
      u_colors[r + clamp(column - 1, 0, 5)], u_colors[r + column],
      u_colors[r + column + 1], u_colors[r + clamp(column + 2, 0, 5)], f.x);
  }
  vec3 color = clamp(catmullRom(rows[0], rows[1], rows[2], rows[3], f.y), 0.0, 1.0);

  // The bloom: a spring-driven ellipse around the composer, its rim breathing until it settles.
  float bloom = 1.0;
  if (u_entry > 0.0) {
    vec2 offset = (gl_FragCoord.xy - u_origin * resolution) / resolution.x;
    offset.y *= BLOOM_ASPECT;
    float progress = 1.0 - (1.0 + ENTRY_SPRING * since) * exp(-ENTRY_SPRING * since);
    float angle = atan(offset.y, offset.x);
    float rim = (0.05 * sin(angle * 3.0 + since * 2.4) + 0.03 * sin(angle * 5.0 - since * 3.3))
      * (1.0 - 0.8 * progress);
    float radius = progress * (BLOOM_REACH + BLOOM_EDGE) + rim;
    bloom = 1.0 - smootherstep(radius - BLOOM_EDGE, radius, length(offset));
  }
  // Move only the coverage, not the field or drawing buffer: colors and pixel grain keep their
  // scale as the upper edge recedes. At rest this is exactly the original falloff.
  float top = mix(1.0, clamp(u_retreatTarget, 0.04, 0.95), u_retreat);
  float falloff = pow(
    max(1.0 - smootherstep(SOLID * top, top, gl_FragCoord.y / resolution.y), 0.0), FALLOFF_POWER);
  vec4 light = vec4(color, 1.0) * clamp(bloom * falloff, 0.0, 1.0) * u_level;
  // A step of triangular noise per channel, faded out where the light is under a step.
  vec2 p = gl_FragCoord.xy;
  vec4 grain = vec4(tpdf(p), tpdf(p + 101.0), tpdf(p + 211.0), tpdf(p + 307.0));
  fragColor = clamp(light + grain / 255.0 * min(light.a * 255.0, 1.0), 0.0, 1.0);
}
`;
