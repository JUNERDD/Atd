/**
 * GLSL shared by every drawing of the command HUD's light field (`IslandGlowField.swift` in the
 * macOS shell): the panel's waiting light (`apps/desktop` `waiting-glow/glow-field.ts`) and the tab
 * light of Atd for Chrome. Insert it after a fragment shader's precision statement and uniforms;
 * it declares `u_colors` (the 24 mesh colors from `glowColors`, calculated once per draw), the
 * helpers below and `glowFieldColor`.
 *
 * The shell draws a 6×4 `MeshGradient` with smoothed colors, 2.2 times the size of its box, and
 * shows a drifting crop of it so the field's edges never become the box's edges. `glowFieldColor`
 * finds a pixel's place on that mesh (undoing the points' small displacement to first order) and
 * blends the 4×4 nearest colors with a Catmull-Rom spline, which stands in for `smoothsColors`.
 * Every value is a function of the time alone. The values mirror the shell's `IslandGlowField`
 * and `IslandGlowStyle`; change both together.
 */
export const GLOW_FIELD_GLSL = `
uniform vec3 u_colors[24];

const float PI = 3.14159265;
const float FIELD_SCALE = 2.2;

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

// The field's color at uv (the box's units, y down, as the shell lays the mesh out) at phase.
vec3 glowFieldColor(vec2 uv, float phase) {
  // This pixel on the larger, drifting field.
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
  return clamp(catmullRom(rows[0], rows[1], rows[2], rows[3], f.y), 0.0, 1.0);
}
`;
