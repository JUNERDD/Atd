/** Full-screen triangle from gl_VertexID; no vertex buffers. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * One pass draws the whole field. Positions are CSS px from the canvas's top-left corner, so the
 * art box, the lens and ripples use the same units as the DOM. Three spaces exist: `p` is the
 * screen; `d` is the panel as the scroll-away dive scales it about the art box's center; `q` is that
 * panel seen through the pointer loupe. Everything that belongs to the panel (dots, art, ripples,
 * the resolve scan) is evaluated per cell in `q`; optical effects (the CRT aperture and beam, the
 * lens glow, the tilt blur, the vignette) stay in `p`.
 */
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec2 u_res;          // drawing buffer, device px
uniform float u_scale;       // device px per CSS px (DPR x render scale)
uniform float u_time;        // seconds
uniform float u_motion;      // 1 = full motion, 0 = reduced motion
uniform float u_boot;        // seconds since power-on; large once settled
uniform float u_scroll;      // 0..1 scroll-away progress
uniform vec3 u_grid;         // origin x, origin y, pitch (CSS px)
uniform sampler2D u_art;     // the shown word's coverage, one texel per cell, mipmapped
uniform sampler2D u_artNext; // the word changing in, during a change (for the halo)
uniform sampler2D u_shape;   // the shown word's signed distance field, in cells
uniform sampler2D u_shapeNext; // the incoming word's
uniform float u_morph;       // seconds into a word change; negative when none
uniform ivec2 u_cells;       // art texture size in cells
uniform vec4 u_artBox;       // where the shown word's ink sits: x, y, width, height
uniform vec2 u_pivot;        // the art box's center: the scroll-away dive's pivot
uniform vec4 u_lens;         // x, y, radius, strength
uniform float u_zoom;        // loupe magnification at its center
uniform vec4 u_ripples[4];   // x, y, start time, amplitude
uniform vec2 u_levels;       // field level, art level
uniform vec3 u_ink;
uniform vec3 u_dot;

out vec4 outColor;

const float TAU = 6.2831853;
const float RIPPLE_LIFE = 1.2;
const float FIELD_RADIUS = 0.19;  // dot radius / pitch
const float ART_RADIUS = 0.34;

// Power-on, in seconds: the CRT line spreads across, the picture opens from it, then a scan
// resolves the art left to right out of static.
const float CRT_SPREAD = 0.22;
const float CRT_OPEN = 0.62;
const float SCAN_START = 0.5;
const float SCAN_TIME = 0.95;

// Word change, in seconds (CHANGE_SECONDS in word-cycle.ts): the change sweeps the board left to
// right over SWEEP, and each cell melts from one word's shape into the next over MELT.
const float SWEEP = 0.55;
const float MELT = 1.0;

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

void main() {
  vec2 size = u_res / u_scale;
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;
  vec2 artCenter = u_artBox.xy + 0.5 * u_artBox.zw;

  // Scroll-away dive: the panel grows about the art box's center as the section leaves.
  float away = u_scroll * u_motion;
  float dive = 1.0 + 1.1 * away * away;
  vec2 d = u_pivot + (p - u_pivot) / dive;

  // Loupe: shrink panel coordinates toward the pointer, which magnifies the grid there. The radial
  // map r * f(r) stays monotonic because f only grows with r, so the grid never folds.
  vec2 lensAt = u_pivot + (u_lens.xy - u_pivot) / dive;
  float lensIn = 1.0 - smoothstep(0.0, u_lens.z, length(p - u_lens.xy));
  vec2 q = lensAt + (d - lensAt) * mix(1.0, 1.0 / u_zoom, lensIn * u_lens.w * u_motion);

  // Mask blur: tilt-shift toward the top and bottom edges, deepening as the section leaves.
  float tilt = smoothstep(0.7, 1.0, abs(p.y / size.y * 2.0 - 1.0)) * 0.8;
  float blur = clamp(tilt + away * 0.75, 0.0, 1.0);

  // Panel cell under this fragment.
  float pitch = u_grid.z;
  vec2 g = (q - u_grid.xy) / pitch;
  vec2 cellF = floor(g);
  ivec2 cell = ivec2(cellF);
  vec2 center = u_grid.xy + (cellF + 0.5) * pitch;
  uvec2 h = pcg2d(uvec2(cell + 65536));
  vec2 r1 = unit2(h);
  vec2 r2 = unit2(pcg2d(h ^ uvec2(0x68bc21ebu, 0x02e5be93u)));

  float cover = 0.0;
  if (all(lessThan(uvec2(cell), uvec2(u_cells)))) cover = texelFetch(u_art, cell, 0).r;
  float glow = textureLod(u_art, g / vec2(u_cells), 1.5).r;
  float inArt = smoothstep(0.32, 0.68, cover);

  // Word change: the board melts one word into the next. Each cell blends the two words' signed
  // distance fields with its own eased progress, so the letters' edges flow continuously from one
  // shape to the other, a dot growing or shrinking as an edge passes it. The change sweeps left to
  // right; while it moves, the edge ripples like a liquid and glows. At either end the blend is
  // exactly one word's field, which gives back its coverage, so the hand-over is invisible.
  float seam = 0.0;
  float melt = 0.0;
  if (u_morph >= 0.0 && all(lessThan(uvec2(cell), uvec2(u_cells)))) {
    float from = texelFetch(u_shape, cell, 0).r;
    float to = texelFetch(u_shapeNext, cell, 0).r;
    float local = clamp((u_morph - SWEEP * (0.85 * center.x / size.x + 0.15 * center.y / size.y)) /
      MELT, 0.0, 1.0);
    melt = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
    float flowing = sin(3.14159265 * melt);
    float ripple = sin(center.x * 0.041 + u_time * 2.4) + sin(center.y * 0.057 - u_time * 1.9);
    float sdf = mix(from, to, melt) + 0.42 * ripple * flowing;
    inArt = smoothstep(0.32, 0.68, clamp(0.5 - sdf, 0.0, 1.0));
    seam = exp(-sdf * sdf * 1.4) * flowing;
  }
  float glowNext = textureLod(u_artNext, g / vec2(u_cells), 1.5).r;
  glow = mix(glow, glowNext, melt);

  // CRT: a bright line spreads from the middle, then the picture opens up and down from it.
  float spread = smoothstep(0.0, CRT_SPREAD, u_boot);
  float open = smoothstep(CRT_SPREAD * 0.5, CRT_OPEN, u_boot);
  float fromMidX = abs(p.x / size.x * 2.0 - 1.0);
  float fromMidY = abs(p.y / size.y * 2.0 - 1.0);
  float across = clamp((spread * 1.1 - fromMidX) / 0.05, 0.0, 1.0);
  float aperture = across * clamp((open * 1.1 - fromMidY) / 0.04, 0.0, 1.0);
  float lineOff = (p.y - size.y * 0.5) / (1.2 + 3.0 * open);
  float crtLine = across * (1.0 - open) * exp(-lineOff * lineOff);

  // Resolve scan: a bar crosses the art; the letters lock in behind it with a brief flash, out of
  // static ahead of it. The front is ragged per cell so it reads as signal, not a wipe.
  float artX = clamp((center.x - u_artBox.x) / max(u_artBox.z, 1.0), 0.0, 1.0);
  float lockAt = SCAN_START + SCAN_TIME * (artX * 0.88 + 0.12 * r2.x);
  float age = u_boot - lockAt;
  float artOn = smoothstep(0.0, 0.05, age);
  float flash = artOn * exp(-max(age, 0.0) * 6.5) * 0.9;
  float scanning = step(SCAN_START - 0.12, u_boot) * (1.0 - artOn);
  float noise = unit2(pcg2d(h ^ uvec2(uint(u_time * 18.0) * 747796405u))).x;
  float staticLevel = scanning * step(mix(0.965, 0.72, inArt), noise) * mix(0.25, 0.55, inArt);
  float scanT = clamp((u_boot - SCAN_START) / SCAN_TIME, 0.0, 1.0);
  float barX = u_artBox.x + u_artBox.z * scanT;
  float barOff = (center.x - barX) / (pitch * 1.4);
  float barSpan = 1.0 - smoothstep(0.0, pitch * 3.0, abs(center.y - artCenter.y) - u_artBox.w * 0.5);
  float bar = exp(-barOff * barOff) * barSpan * step(0.001, scanT) * (1.0 - step(1.0, scanT));
  float artOnAvg = smoothstep(SCAN_START, SCAN_START + SCAN_TIME + 0.2, u_boot);

  // Scroll-away: art dots dissolve in hashed order (a uniform fade under reduced motion).
  float order = r2.y * 0.62;
  float keepAvg = 1.0 - smoothstep(0.0, 0.72, u_scroll);
  float keep = mix(keepAvg, 1.0 - smoothstep(order, order + 0.08, u_scroll), u_motion);
  float lit = inArt * artOn * keep;

  // Field dots: hashed base level, a subtle twinkle and the slow scanline band.
  float yN = center.y / size.y;
  float twinkle = 1.0 + u_motion * 0.3 * sin(u_time * (0.4 + 1.3 * r1.y) + TAU * r1.x);
  float band = fract(u_time / 7.0) * 1.5 - 0.25;
  float scanOffset = (yN - band) * 8.0;
  float scan = u_motion * exp(-scanOffset * scanOffset);
  float fieldDim = 1.0 - 0.6 * u_scroll;
  float field = u_levels.x * (0.75 + 0.5 * r1.x) * twinkle * (1.0 + 1.1 * scan) * fieldDim;

  // Ripples: decelerating rings; under reduced motion a stationary glow that fades.
  float ripple = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 rp = u_ripples[i];
    float rippleAge = max(u_time - rp.z, 0.0);
    if (rippleAge > RIPPLE_LIFE) continue;
    float life = 1.0 - rippleAge / RIPPLE_LIFE;
    float radius = u_motion * rippleAge * (640.0 - 240.0 * rippleAge);
    float width = mix(56.0, 20.0 + 30.0 * rippleAge, u_motion);
    float off = length(center - (u_pivot + (rp.xy - u_pivot) / dive)) - radius;
    ripple += rp.w * life * life * exp(-off * off / (width * width));
  }

  float lens = u_lens.w * lensIn;
  float level = mix(field + staticLevel + bar * 0.55, u_levels.y * (1.0 + flash), lit) + seam * 0.5;
  level += (lens * 0.5 + ripple * 0.85) * (1.0 - 0.5 * lit);
  float radius = pitch * (mix(FIELD_RADIUS, ART_RADIUS, max(lit, staticLevel * 0.9)) +
    0.05 * lens + 0.08 * min(ripple, 1.0) + 0.06 * seam);

  // Defocus: dots soften, swell and dim (keeping their energy), then settle into a smooth haze
  // built from the mipmapped art.
  float dist = length(q - center);
  float aa = 0.5 * (fwidth(q.x) + fwidth(q.y));
  float soft = max(0.7 * aa, 1e-3) + blur * pitch * 0.4;
  float rad = radius * (1.0 + 0.3 * blur);
  float shape = 1.0 - smoothstep(rad - soft, rad + soft, dist);
  float energy = min(1.0, radius * radius / (rad * rad + 0.5 * soft * soft));
  float v = shape * level * energy;

  float artAvg = smoothstep(0.15, 0.85, glow) * artOnAvg * keepAvg;
  float haze = mix(u_levels.x * fieldDim * 0.113, u_levels.y * 0.363, artAvg);
  v = mix(v, haze * 1.35, smoothstep(0.45, 1.0, blur));
  v += glow * artOnAvg * keepAvg * 0.045;
  v = v * aperture + crtLine * 1.4;

  vec2 c = p / size * 2.0 - 1.0;
  v *= 1.0 - 0.2 * smoothstep(0.6, 1.6, dot(c, c));
  v += (unit2(pcg2d(uvec2(gl_FragCoord.xy))).x - 0.5) / 255.0 * step(0.004, v);
  outColor = vec4(mix(u_ink, u_dot, clamp(v, 0.0, 1.0)), 1.0);
}
`;
