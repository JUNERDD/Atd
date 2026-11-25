import { GLOW_FIELD_GLSL } from '@atd/ui/lib/glow/field-glsl';

/**
 * The tab's light: the command HUD's field (`IslandGlowField`, shared as `GLOW_FIELD_GLSL`) drawn
 * as a band along the tab's edges instead of behind the composer. The band, its slow breathing,
 * the bloom out of the HUD and the hue shift are the prototype's (`glow.js`); the bloom spring and
 * its constants match the panel's waiting light (`apps/desktop` `waiting-glow/glow-field.ts`).
 *
 * Coverage is decided first and a pixel outside the band returns at once: across a whole viewport
 * only the edges light up, so most pixels never evaluate the field. The light is drawn at its final
 * strength (`u_level`) with a step of triangular noise per channel, so it does not band; a CSS
 * opacity carries only the fades (it would scale the dither down with the light).
 */
export const GLOW_VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const GLOW_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 u_res;
uniform float u_phase;
// Seconds since the light came on, for the bloom.
uniform float u_since;
// 1 while the light blooms in; 0 when it is in from the start (Reduce Motion).
uniform float u_entry;
// Where the bloom starts (the HUD's centre), in device px from the bottom left.
uniform vec2 u_origin;
// The band's depth and the corner radius it follows, in device px.
uniform float u_band;
uniform float u_radius;
uniform float u_level;
// The hue rotation in radians (the done shift).
uniform float u_hue;

out vec4 fragColor;
${GLOW_FIELD_GLSL}
// The bloom's spring, per second: critically damped, so it starts at rest and never overshoots.
const float ENTRY_SPRING = 9.0;
const float BLOOM_ASPECT = 1.6;
const float BLOOM_EDGE = 0.5;
const float BLOOM_REACH = 1.3;
// Below 1 the band holds more light near the edge and lets its faint tail reach further in.
const float FALLOFF_POWER = 0.7;

// The CSS hue-rotate() matrix, so the shift matches waiting-glow.css's writing filter.
vec3 hueRotate(vec3 c, float a) {
  float ca = cos(a);
  float sa = sin(a);
  mat3 m = mat3(
    0.213 + 0.787 * ca - 0.213 * sa, 0.213 - 0.213 * ca + 0.143 * sa, 0.213 - 0.213 * ca - 0.787 * sa,
    0.715 - 0.715 * ca - 0.715 * sa, 0.715 + 0.285 * ca + 0.140 * sa, 0.715 - 0.715 * ca + 0.715 * sa,
    0.072 - 0.072 * ca + 0.928 * sa, 0.072 - 0.072 * ca - 0.283 * sa, 0.072 + 0.928 * ca + 0.072 * sa);
  return m * c;
}

void main() {
  vec2 uv0 = gl_FragCoord.xy / u_res;
  float phase = u_phase;

  // Distance into the tab from its rounded edge; the band breathes slowly along the edge.
  vec2 halfSize = u_res * 0.5;
  vec2 q = abs(gl_FragCoord.xy - halfSize) - (halfSize - vec2(u_radius));
  float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
  float d = max(-outside, 0.0);
  float wob = 1.0 + 0.18 * sin(uv0.x * 7.0 + phase * 0.6) + 0.18 * sin(uv0.y * 6.0 - phase * 0.45);
  float coverage = pow(max(1.0 - smootherstep(0.0, u_band * wob, d), 0.0), FALLOFF_POWER);

  if (u_entry > 0.0) {
    vec2 offset = (gl_FragCoord.xy - u_origin) / u_res.x;
    offset.y *= BLOOM_ASPECT;
    float since = u_since;
    float progress = 1.0 - (1.0 + ENTRY_SPRING * since) * exp(-ENTRY_SPRING * since);
    float angle = atan(offset.y, offset.x);
    float rim = (0.05 * sin(angle * 3.0 + since * 2.4) + 0.03 * sin(angle * 5.0 - since * 3.3))
      * (1.0 - 0.8 * progress);
    float radius = progress * (BLOOM_REACH + BLOOM_EDGE) + rim;
    coverage *= 1.0 - smootherstep(radius - BLOOM_EDGE, radius, length(offset));
  }
  coverage = clamp(coverage, 0.0, 1.0);
  if (coverage <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  // The field in the box's units, y down, as the shell lays the mesh out.
  vec3 color = glowFieldColor(vec2(uv0.x, 1.0 - uv0.y), phase);
  color = clamp(hueRotate(color, u_hue), 0.0, 1.0);
  vec4 light = vec4(color, 1.0) * coverage * u_level;
  vec2 p = gl_FragCoord.xy;
  vec4 grain = vec4(tpdf(p), tpdf(p + 101.0), tpdf(p + 211.0), tpdf(p + 307.0));
  fragColor = clamp(light + grain / 255.0 * min(light.a * 255.0, 1.0), 0.0, 1.0);
}
`;

/** Every uniform the runner sets. */
export const GLOW_UNIFORMS = [
  'u_res',
  'u_phase',
  'u_since',
  'u_entry',
  'u_origin',
  'u_band',
  'u_radius',
  'u_level',
  'u_hue',
  'u_colors',
] as const;
export type GlowUniform = (typeof GLOW_UNIFORMS)[number];
