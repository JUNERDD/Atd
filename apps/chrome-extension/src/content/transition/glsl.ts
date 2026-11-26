/**
 * The GLSL both page transitions build on: a full-screen triangle and the fragment preamble. The
 * transitions' math is the prototype's (`tmp/chrome-glow-prototypes/harness/snap.js`, WARP.md ›
 * Snapshot transitions); what the extension adds is where the frame sits and where it must not
 * draw:
 *
 * - The frame (the tab's capture) is drawn 1:1 in device px, anchored at the viewport's top left
 *   (`u_shift`), so a viewport whose height changes mid-transition (Chrome's debugger infobar
 *   coming or going) never stretches it; outside the frame the canvas is clear.
 * - Atd's own layers are in the capture. Inside their rects, grown by a soft margin for the HUD's
 *   shadow, both as captured (`u_frozen`) and as they are now (`u_live`), the canvas is clear; so
 *   is a fragment whose displaced samples land in a captured one. The live page and the live HUD
 *   show there, never a ghost of the HUD through its translucent glass.
 *
 * Fragments are premultiplied (`shade`); with no masks and an unchanged viewport every opaque
 * fragment is the prototype's.
 */

/** Rects per mask set; unused slots are parked far outside the frame (`frame.ts`). */
export const MASK_SLOTS = 4;

export const TRANSITION_VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const TRANSITION_COMMON = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
// The frame's size (CSS px), device px per CSS px, HUD centre (CSS px from the frame's bottom left).
uniform vec2 u_size;
uniform float u_dpr;
uniform vec2 u_origin;
// Progress 0..1 and seconds since the first frame.
uniform float u_t;
uniform float u_time;
// Page darkness 0..1; the working palette's cool tone drawn over a light page / added to a dark one.
uniform float u_dark;
uniform vec3 u_tint;
uniform vec3 u_glow;
// Device px from the canvas's bottom edge down to the frame's (frame height - canvas height).
uniform float u_shift;
// Atd's surfaces as (min.x, min.y, max.x, max.y) in frame CSS px: as captured, and as they are now.
uniform vec4 u_frozen[${MASK_SLOTS}];
uniform vec4 u_live[${MASK_SLOTS}];
out vec4 outColor;

// This fragment in the frame's device px (origin bottom left).
vec2 framePx() { return gl_FragCoord.xy + vec2(0.0, u_shift); }

vec3 tap(vec2 q) { return textureLod(u_tex, q / u_size, 0.0).rgb; }
vec3 exact() { return texelFetch(u_tex, ivec2(framePx()), 0).rgb; }

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// A light page takes the tone over it; a dark page takes it as added light.
vec3 lift(vec3 c, float a) {
  return mix(mix(c, u_tint, a), c + u_glow * a, u_dark);
}

// The soft margin around each of Atd's surfaces (the HUD's shadow reaches about this far).
const float MASK_SOFT = 32.0;
// 0 inside the rect, rising to 1 over MASK_SOFT CSS px around it.
float clearOf(vec2 q, vec4 r) {
  vec2 d = max(r.xy - q, q - r.zw);
  return smoothstep(0.0, MASK_SOFT, length(max(d, 0.0)));
}
// 0 where a sample would read one of Atd's surfaces as captured (its ghost in the frame).
float ghostFree(vec2 q) {
  float a = 1.0;
  for (int i = 0; i < ${MASK_SLOTS}; i++) a = min(a, clearOf(q, u_frozen[i]));
  return a;
}
// How much of the fragment at p the canvas may cover: none outside the frame or on a surface.
float coverage(vec2 p) {
  float a = ghostFree(p);
  for (int i = 0; i < ${MASK_SLOTS}; i++) a = min(a, clearOf(p, u_live[i]));
  vec2 inside = step(vec2(0.0), p) * step(p, u_size);
  return a * inside.x * inside.y;
}
vec4 shade(vec3 c, float a) { return vec4(c * a, a); }
`;
