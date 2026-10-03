import { getShaderColorFromString } from '@paper-design/shaders-react';

/**
 * One of the welcome guide's lights (after the Grainient hero): a design's GLSL on the shared
 * prelude below, and the values it needs. Every design shares the palette and the conventions:
 *
 * - `light(f, p, t)` returns the display color at this pixel, 0 to 1, black where there is no
 *   light. `f` is the position in the frame's own axes (-1 to 1 on each, y up), for composition
 *   that holds at any aspect ratio; `p` is in square units of the frame's short side (centered),
 *   for texture that never stretches; `t` is the light's time in seconds.
 * - The prelude provides `u_entrance` (the entrance's length in seconds, 0 for none), `u_colors`
 *   (cyan, indigo, coral, peach), `u_rim` (cyan-white), `hash`, `noise` (value noise, 0 to 1),
 *   `ridge` (a thin bright line where noise crosses its middle) and `expose` (a filmic roll-off).
 * - The light is premultiplied and its alpha is its brightness, so black is transparent: the host
 *   decides what shows through. Film grain is not drawn here but masked onto the canvas at full
 *   resolution (`guide-light.css`), so a design renders at a fraction of the display's pixels.
 */
export interface LightDesign {
  /** GLSL declaring the design's uniforms and defining `vec3 light(vec2 f, vec2 p, float t)`. */
  glsl: string;
  /** Values for the uniforms `glsl` declares. */
  uniforms?: Readonly<Record<string, number | readonly number[]>>;
  /** The most device pixels the light renders; the canvas is scaled up to its box beyond that. */
  maxPixels: number;
  /** Where in its time the light starts, in ms; also its still frame under Reduce Motion. */
  start?: number;
}

const PRELUDE = `#version 300 es
precision highp float;

uniform float u_time;
// Paper's vertex shader declares it at medium precision; the two declarations must match.
uniform mediump vec2 u_resolution;
uniform float u_entrance;
uniform vec4 u_colors[4];
uniform vec4 u_rim;

out vec4 fragColor;

const float TAU = 6.28318530718;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(
    mix(hash(i), hash(i + vec2(1., 0.)), u.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x),
    u.y
  );
}
float ridge(float n, float k) {
  return pow(1. - abs(2. * n - 1.), k);
}
vec3 expose(vec3 light, float k) {
  return 1. - exp(-light * k);
}
`;

const MAIN = `
void main() {
  vec2 c = gl_FragCoord.xy - .5 * u_resolution;
  vec3 color = clamp(light(c / (.5 * u_resolution), c / min(u_resolution.x, u_resolution.y), u_time), 0., 1.);
  fragColor = vec4(color, max(color.r, max(color.g, color.b)));
}
`;

/** A design's whole fragment shader. */
export function lightShader(design: LightDesign): string {
  return PRELUDE + design.glsl + MAIN;
}

/**
 * The palette every light shares: cyan and indigo (cool), coral and peach (warm). It is the
 * artwork's own, like the colors of an image asset, not a theme token.
 */
export const LIGHT_COLORS = ['#1aa8c4', '#25307a', '#f0602f', '#ffb08f'].map(
  getShaderColorFromString,
);

/** The rims' cyan-white. */
export const LIGHT_RIM = getShaderColorFromString('#bfeaf6');
