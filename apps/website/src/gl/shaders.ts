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
 * the power-on wave) is evaluated per cell in `q`; optical effects (the lens glow, the tilt blur,
 * the vignette) stay in `p`.
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
uniform sampler2D u_art;     // the word on the board: coverage (r, mipmapped), character (g)
uniform float u_shown;       // characters of it showing, from its first
uniform float u_typing;      // 1 while words are being erased and typed, else 0
uniform float u_settle;      // seconds since the shown word arrived; negative before it has
uniform vec4 u_cursor;       // the shown word's block cursor: past its last line, cap high
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

// Power-on, in seconds (BOOT_SECONDS in dot-field.ts covers it): the field wakes outward from the
// word's center, the wave reaching the farthest corner after WAKE_TIME, each dot easing up from dark
// over WAKE_FADE with a faint glow as the front passes. The word lights behind it, left to right
// from WORD_START over WORD_SWEEP, each letter dot swelling from a field dot to full size over
// WORD_GROW.
const float WAKE_TIME = 0.7;
const float WAKE_FADE = 0.5;
const float WORD_START = 0.12;
const float WORD_SWEEP = 0.72;
const float WORD_GROW = 0.55;

// The block cursor of lit dots after the typed characters (typing.ts sets the pace): steady while
// words are erased and typed, then blinking on and off every CURSOR_BLINK seconds while the word
// rests, as if the panel were waiting for the next task. Steady under reduced motion.
const float CURSOR_BLINK = 0.53;

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

  // The word's dots, only as far as it is typed: a cell shows if its character is among the first
  // u_shown (cells without ink carry character 0). The halo waits for the whole word.
  vec2 texel = vec2(0.0);
  if (all(lessThan(uvec2(cell), uvec2(u_cells)))) texel = texelFetch(u_art, cell, 0).rg;
  float typed = step(texel.g * 255.0, u_shown + 0.5);
  float inArt = smoothstep(0.32, 0.68, texel.r) * typed;
  float glow = textureLod(u_art, g / vec2(u_cells), 1.5).r * (1.0 - u_typing);

  // Power-on wake: each dot eases up from dark on its own clock, set by its distance from the word's
  // center with a little jitter, so the light spreads outward as a soft wave with no edge. The front
  // glows faintly as it passes, then settles to the field's level.
  float far = length(max(artCenter, size - artCenter));
  float wakeAt = WAKE_TIME * length(center - artCenter) / far + 0.12 * r1.y;
  float wake = clamp((u_boot - wakeAt) / WAKE_FADE, 0.0, 1.0);
  float wakeGlow = sin(3.14159265 * wake) * 0.14;
  wake = wake * wake * (3.0 - 2.0 * wake);

  // The word lights behind the wave, left to right with a ragged front: each letter dot swells from
  // a field dot to full size on an ease-out, glowing a little on the way.
  float artX = clamp((center.x - u_artBox.x) / max(u_artBox.z, 1.0), 0.0, 1.0);
  float lockAt = WORD_START + WORD_SWEEP * (artX * 0.85 + 0.15 * r2.x);
  float grow = clamp((u_boot - lockAt) / WORD_GROW, 0.0, 1.0);
  float artOn = 1.0 - (1.0 - grow) * (1.0 - grow) * (1.0 - grow);
  float flash = sin(3.14159265 * grow) * 0.3;
  float artOnAvg = smoothstep(WORD_START, WORD_START + WORD_SWEEP + WORD_GROW, u_boot);

  // The cursor: the cells inside its box, lit on the blink's on beats while the word rests.
  vec2 inCursor = step(u_cursor.xy, center) * step(center, u_cursor.xy + u_cursor.zw);
  float blinkOn = 1.0 - step(CURSOR_BLINK, mod(max(u_settle, 0.0), 2.0 * CURSOR_BLINK));
  float resting = step(0.0, u_settle) * blinkOn;
  float cursor = inCursor.x * inCursor.y * mix(1.0, max(u_typing, resting), u_motion);

  // Scroll-away: art dots dissolve in hashed order (a uniform fade under reduced motion).
  float order = r2.y * 0.62;
  float keepAvg = 1.0 - smoothstep(0.0, 0.72, u_scroll);
  float keep = mix(keepAvg, 1.0 - smoothstep(order, order + 0.08, u_scroll), u_motion);
  float lit = max(inArt * artOn, cursor) * keep;

  // Field dots: hashed base level, a subtle twinkle and the slow scanline band.
  float yN = center.y / size.y;
  float twinkle = 1.0 + u_motion * 0.3 * sin(u_time * (0.4 + 1.3 * r1.y) + TAU * r1.x);
  float band = fract(u_time / 7.0) * 1.5 - 0.25;
  float scanOffset = (yN - band) * 8.0;
  float scan = u_motion * exp(-scanOffset * scanOffset);
  float fieldDim = 1.0 - 0.6 * u_scroll;
  float field = u_levels.x * (0.75 + 0.5 * r1.x) * twinkle * (1.0 + 1.1 * scan) * fieldDim * wake;

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
  float level = mix(field + wakeGlow, u_levels.y * (1.0 + flash), lit);
  level += (lens * 0.5 + ripple * 0.85) * (1.0 - 0.5 * lit) * wake;
  float radius = pitch * (mix(FIELD_RADIUS * (0.55 + 0.45 * wake), ART_RADIUS, lit) +
    0.05 * lens + 0.08 * min(ripple, 1.0));

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
  v = mix(v, haze * 1.35 * wake, smoothstep(0.45, 1.0, blur));
  v += glow * artOnAvg * keepAvg * 0.045;

  vec2 c = p / size * 2.0 - 1.0;
  v *= 1.0 - 0.2 * smoothstep(0.6, 1.6, dot(c, c));
  v += (unit2(pcg2d(uvec2(gl_FragCoord.xy))).x - 0.5) / 255.0 * step(0.004, v);
  outColor = vec4(mix(u_ink, u_dot, clamp(v, 0.0, 1.0)), 1.0);
}
`;
