/** Full-screen triangle from gl_VertexID; no vertex buffers. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * One pass draws the whole field. Positions are CSS px from the canvas's top-left corner, so focus
 * rects, the lens and ripples use the same units as the DOM. Two spaces exist: `p` is the screen,
 * `q` is the panel seen through the pointer loupe; everything that belongs to the panel (dots, art,
 * boot, ripples, scanline) is evaluated per cell in `q`, while optical effects (lens glow, mask blur)
 * stay in `p`.
 */
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_res;          // drawing buffer, device px
uniform float u_scale;       // device px per CSS px (DPR x render scale)
uniform float u_time;        // seconds
uniform float u_motion;      // 1 = full motion, 0 = reduced motion
uniform float u_boot;        // seconds since power-on; large once settled
uniform float u_scroll;      // 0..1 scroll-away progress
uniform vec3 u_grid;         // origin x, origin y, pitch (CSS px)
uniform sampler2D u_art;     // art coverage, one texel per cell, mipmapped
uniform ivec2 u_cells;       // art texture size in cells
uniform vec4 u_lens;         // x, y, radius, strength
uniform float u_zoom;        // loupe magnification at its center
uniform vec4 u_ripples[4];   // x, y, start time, amplitude
uniform vec4 u_rects[2];     // center x, center y, half width, half height
uniform vec2 u_rectShape[2]; // corner radius, feather
uniform int u_rectCount;
uniform vec3 u_levels;       // field level, art level, focus dimming
uniform vec3 u_ink;
uniform vec3 u_dot;

out vec4 outColor;

const float TAU = 6.2831853;
const float RIPPLE_LIFE = 1.2;
const float FIELD_RADIUS = 0.19;  // dot radius / pitch
const float ART_RADIUS = 0.34;

uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v;
}

vec2 unit2(uvec2 h) {
  return vec2(h >> 8u) * (1.0 / 16777216.0);
}

float roundRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
  vec2 size = u_res / u_scale;
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;

  // Loupe: shrink panel coordinates toward the pointer, which magnifies the grid there. The radial
  // map r * f(r) stays monotonic because f only grows with r, so the grid never folds.
  vec2 toLens = p - u_lens.xy;
  float lensIn = 1.0 - smoothstep(0.0, u_lens.z, length(toLens));
  vec2 q = u_lens.xy + toLens * mix(1.0, 1.0 / u_zoom, lensIn * u_lens.w * u_motion);

  // Mask blur: tilt-shift toward the top and bottom edges, plus the registered focus rects.
  float tilt = smoothstep(0.76, 1.0, abs(p.y / size.y * 2.0 - 1.0)) * 0.75;
  float focus = 0.0;
  for (int i = 0; i < 2; i++) {
    if (i >= u_rectCount) break;
    float sd = roundRect(p - u_rects[i].xy, u_rects[i].zw, u_rectShape[i].x);
    focus = max(focus, 1.0 - smoothstep(0.0, u_rectShape[i].y, sd));
  }
  float blur = clamp(max(tilt, focus) + u_scroll * 0.75 * u_motion, 0.0, 1.0);

  // Panel cell under this fragment.
  float pitch = u_grid.z;
  vec2 g = (q - u_grid.xy) / pitch;
  vec2 cellF = floor(g);
  ivec2 cell = ivec2(cellF);
  vec2 center = u_grid.xy + (cellF + 0.5) * pitch;
  float dist = length(q - center);
  uvec2 h = pcg2d(uvec2(cell + 65536));
  vec2 r1 = unit2(h);
  vec2 r2 = unit2(pcg2d(h ^ uvec2(0x68bc21ebu, 0x02e5be93u)));

  float cover = 0.0;
  if (all(lessThan(uvec2(cell), uvec2(u_cells)))) cover = texelFetch(u_art, cell, 0).r;
  float glow = textureLod(u_art, g / vec2(u_cells), 1.5).r;

  // Power-on: a sweep lights the field top to bottom, then art dots light in hashed order with a
  // brief brightness overshoot (no size change).
  float yN = center.y / size.y;
  float front = u_boot * 1.9 - yN;
  float fieldOn = smoothstep(0.0, 0.12, front);
  float beam = exp(-front * front * 180.0) * (1.0 - smoothstep(0.55, 0.75, u_boot));
  float artAge = u_boot - (0.36 + 0.56 * r2.x);
  float artOn = smoothstep(0.0, 0.045, artAge);
  float flash = artOn * exp(-max(artAge, 0.0) * 7.5) * 0.85;
  float artOnAvg = smoothstep(0.36, 0.92, u_boot);

  // Scroll-away: art dots dissolve in hashed order (a uniform fade under reduced motion).
  float order = r2.y * 0.62;
  float keepAvg = 1.0 - smoothstep(0.0, 0.72, u_scroll);
  float keep = mix(keepAvg, 1.0 - smoothstep(order, order + 0.08, u_scroll), u_motion);
  float lit = smoothstep(0.32, 0.68, cover) * artOn * keep;

  // Field dots: hashed base level, a subtle twinkle and the slow scanline band.
  float twinkle = 1.0 + u_motion * 0.3 * sin(u_time * (0.4 + 1.3 * r1.y) + TAU * r1.x);
  float band = fract(u_time / 7.0) * 1.5 - 0.25;
  float scanOffset = (yN - band) * 8.0;
  float scan = u_motion * exp(-scanOffset * scanOffset);
  float fieldDim = 1.0 - 0.6 * u_scroll;
  float field = u_levels.x * (0.75 + 0.5 * r1.x) * twinkle * (1.0 + 1.1 * scan) * fieldOn * fieldDim;

  // Ripples: decelerating rings; under reduced motion a stationary glow that fades.
  float ripple = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 rp = u_ripples[i];
    float age = max(u_time - rp.z, 0.0);
    if (age > RIPPLE_LIFE) continue;
    float life = 1.0 - age / RIPPLE_LIFE;
    float radius = u_motion * age * (640.0 - 240.0 * age);
    float width = mix(56.0, 20.0 + 30.0 * age, u_motion);
    float off = length(center - rp.xy) - radius;
    ripple += rp.w * life * life * exp(-off * off / (width * width));
  }

  float lens = u_lens.w * lensIn * (1.0 - 0.8 * focus);
  float level = mix(field + beam * 0.45, u_levels.y * (1.0 + flash), lit);
  level += (lens * 0.5 + ripple * 0.85) * (1.0 - 0.5 * lit);
  float radius = pitch * (mix(FIELD_RADIUS, ART_RADIUS, lit) + 0.05 * lens + 0.08 * min(ripple, 1.0));

  // Defocus: dots soften, swell and dim (keeping their energy), then settle into a smooth haze
  // built from the mipmapped art, so text over a focus rect sits on a calm surface.
  float aa = 0.5 * (fwidth(q.x) + fwidth(q.y));
  float soft = max(0.7 * aa, 1e-3) + blur * pitch * 0.4;
  float rad = radius * (1.0 + 0.3 * blur);
  float shape = 1.0 - smoothstep(rad - soft, rad + soft, dist);
  float energy = min(1.0, radius * radius / (rad * rad + 0.5 * soft * soft));
  float v = shape * level * energy;

  float fieldAvg = u_levels.x * fieldDim * smoothstep(0.0, 0.12, u_boot * 1.9 - p.y / size.y);
  float artAvg = smoothstep(0.15, 0.85, glow) * artOnAvg * keepAvg;
  float haze = mix(fieldAvg * 0.113, u_levels.y * 0.363, artAvg);
  v = mix(v, haze * 1.35, smoothstep(0.45, 1.0, blur));
  v += glow * artOnAvg * keepAvg * 0.045 * (1.0 - focus);
  v *= 1.0 - u_levels.z * focus;

  vec2 c = p / size * 2.0 - 1.0;
  v *= 1.0 - 0.2 * smoothstep(0.6, 1.6, dot(c, c));
  v += (unit2(pcg2d(uvec2(gl_FragCoord.xy))).x - 0.5) / 255.0 * step(0.004, v);
  outColor = vec4(mix(u_ink, u_dot, clamp(v, 0.0, 1.0)), 1.0);
}
`;
