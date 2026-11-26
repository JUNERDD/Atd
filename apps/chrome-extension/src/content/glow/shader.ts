import { GLOW_NOISE_GLSL } from '@atd/ui/lib/glow/field-glsl';
import { EDGE_GEOMETRY_GLSL } from './edge-geometry.ts';
import { GLYPH_GLSL, GLYPH_MAX_CLICKS } from './glyph.ts';

/**
 * The tab's light: Glyph Stream (`glyph.ts`), a dot-matrix band of glyphs along the tab's edges
 * whose cells resolve outward from the HUD's centre when it comes on. The palette blend, the freeze
 * and the done hue shift are eased by `TabGlow` and arrive as uniforms, so a change of state never
 * restarts the light. The HUD itself gets no light of its own: only its centre, the entry's origin,
 * reaches the shader, and its glass shows the band through it like the rest of the page.
 *
 * The band decides its coverage first and a pixel outside it returns at once: across a whole
 * viewport only the edges light up. The light is drawn at its final strength (`u_level`) with a
 * step of triangular noise per channel, so it does not band; a CSS opacity carries only the fades
 * (it would scale the dither down with the light).
 */
export const GLOW_VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const GLOW_FRAGMENT = `#version 300 es
precision highp float;

// Canvas size in device px; device px per CSS px.
uniform vec2 u_res;
uniform float u_dpr;
// The light's clock (s): it runs ahead while the light gathers and stops when frozen. All motion
// follows it.
uniform float u_phase;
// Seconds since the light came on, for its entry.
uniform float u_since;
// 1 when the light resolves out of the HUD as it comes on; 0 when it only fades in (Reduce Motion).
uniform float u_entry;
// The HUD's centre, where the entry starts, in device px from the bottom left.
uniform vec2 u_origin;
// The agent's recent clicks, in device px from the bottom left: z the seconds since, w 1 for a
// click (unused entries are (0, 0, 1000, 0)).
uniform vec4 u_clicks[${GLYPH_MAX_CLICKS}];
// The band's depth and its corner radius, in device px.
uniform float u_band;
uniform float u_radius;
uniform float u_level;
// The hue rotation in radians (the done shift).
uniform float u_hue;
// How dark the page is: 0 the light is drawn over it, 1 it is added to it (plus-lighter).
uniform float u_dark;
// The eased palette blends: needs the person (amber), disconnected (drained, still).
uniform float u_attention;
uniform float u_frozen;
// 1 under Reduce Motion.
uniform float u_reduce;
// The palette's deep, steel and mist tones, blended for this page and state.
uniform vec3 u_tones[3];

out vec4 fragColor;
${GLOW_NOISE_GLSL}
// The CSS hue-rotate() matrix, so the done shift matches waiting-glow.css's writing filter.
vec3 hueRotate(vec3 c, float a) {
  float ca = cos(a);
  float sa = sin(a);
  mat3 m = mat3(
    0.213 + 0.787 * ca - 0.213 * sa, 0.213 - 0.213 * ca + 0.143 * sa, 0.213 - 0.213 * ca - 0.787 * sa,
    0.715 - 0.715 * ca - 0.715 * sa, 0.715 + 0.285 * ca + 0.140 * sa, 0.715 - 0.715 * ca + 0.715 * sa,
    0.072 - 0.072 * ca + 0.928 * sa, 0.072 - 0.072 * ca - 0.283 * sa, 0.072 + 0.928 * ca + 0.072 * sa);
  return m * c;
}
${EDGE_GEOMETRY_GLSL}
${GLYPH_GLSL}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 light = glyphStream(p);
  if (light.a <= 0.0 && dot(light.rgb, vec3(1.0)) <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }
  light.rgb = max(hueRotate(light.rgb, u_hue), 0.0);
  light = clamp(light, 0.0, 1.0) * u_level;
  vec4 grain = vec4(tpdf(p), tpdf(p + 101.0), tpdf(p + 211.0), tpdf(p + 307.0));
  fragColor = clamp(light + grain / 255.0 * min(light.a * 255.0, 1.0), 0.0, 1.0);
}
`;

/** Every uniform the runner sets. */
export const GLOW_UNIFORMS = [
  'u_res',
  'u_dpr',
  'u_phase',
  'u_since',
  'u_entry',
  'u_origin',
  'u_clicks',
  'u_band',
  'u_radius',
  'u_level',
  'u_hue',
  'u_dark',
  'u_attention',
  'u_frozen',
  'u_reduce',
  'u_tones',
] as const;
export type GlowUniform = (typeof GLOW_UNIFORMS)[number];
