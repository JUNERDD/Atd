import type { LightDesign } from './light-design';

/**
 * The provider page's light, converging threads (after the Grainient hero): many thin, silky
 * filaments enter from the frame's top and bottom edges and curve inward into the Atd symbol, like
 * threads drawn into one connection point, the many providers joining into one. Warm threads
 * (coral to peach) fan down from the top, cool ones (indigo and cyan) up from the bottom, so the
 * two fans stay in contrast. Each fan gathers into a few broad bundles with dark gaps between
 * them, made of fine streaks along the flow. The threads brighten as they converge, rolling off
 * toward white, and fade out just before the symbol's tile, leaving it and the brand marks around
 * it on the dark field; slow pulses of light travel along them toward the center.
 *
 * Composition: positions are in the art's own unit (`--u` in `art-illustration.css`, derived from
 * the canvas the same way), so the funnel's waist, the gap above the tile and the dark pockets
 * behind the six marks land on the art at any panel size. The funnel's depth follows the frame's
 * height, so threads always enter from the edges: tall fans in the side panel, wide flat fans
 * reaching in from the ends in the short stacked strip.
 *
 * Cost: a lit pixel takes five noises; pixels around the symbol, behind the marks and past the
 * fans' sides return after one.
 */
export const PROVIDER_LIGHT: LightDesign = {
  glsl: `
// The art's unit (--u: 0.4% of the panel's width or 0.75% of its height, the smaller) in pixels.
float artUnit() {
  return min(.004 * u_resolution.x, .0075 * u_resolution.y);
}

// The distance to the nearest brand mark's center, in art units (the slots of .guide-orbit, which
// mirror across the symbol).
float markDistance(vec2 a) {
  vec2 m = vec2(abs(a.x), a.y);
  return min(min(length(m - vec2(64., 28.)), length(m - vec2(86., -6.))), length(m - vec2(48., -34.)));
}

vec3 light(vec2 f, vec2 p, float t) {
  vec2 frame = .5 * u_resolution / artUnit();
  vec2 a = f * frame;
  // The upper fan is warm and leans one way, the lower cool and leans the other; they never meet,
  // so the switch at the middle has no seam.
  float top = step(0., a.y);
  float side = top * 2. - 1.;
  float w = noise(a * .012 + vec2(t * .02, top * 7.)) - .5;

  // The funnel: the height past the tile's edge (24 units) and a thread's place at the frame's edge.
  // Threads follow x = s * g(d), wide at the edge and narrowing to a waist above the tile.
  float d = abs(a.y) - 26. + 8. * w;
  float depth = max(frame.y - 26., 30.);
  float k = max(d, 0.) / depth;
  float g = .07 + .93 * pow(k, 1.5);
  float s = (a.x + 16. * w - side * .22 * d) / g;

  // The fade before the tile, the fans' sides, and the dark pockets behind the marks.
  float reach = smoothstep(5., 34., d) * exp(-pow(s / (1.4 * frame.x), 2.));
  reach *= smoothstep(12., 30., markDistance(a));
  if (reach < .002) return vec3(0.);

  // The threads' on-screen spacing relative to the edge (the funnel's width over its slope):
  // where they bunch, the fine detail would alias, so it melts into the bundle's glow.
  float q = g / sqrt(1. + pow(s * 1.395 * sqrt(k) / depth + side * .22, 2.));

  // A few broad bundles across the threads, wavering slowly along them.
  float b = s * .013 + .7 * noise(vec2(s * .01 + top * 4., d * .01 - t * .02));
  float id = floor(b + .5);
  float bundle = mix(.7, pow(.5 + .5 * cos(b * TAU), 2.4), smoothstep(.04, .14, q));

  // Fine filaments inside them: long along the flow, thin across it, drifting inward.
  float s1 = ridge(noise(vec2(s * .32, d * .011 + t * .05 + top * 9.)), 5.);
  float s2 = ridge(noise(vec2(s * .75 + 3., d * .018 + t * .07)), 7.);
  float threads = mix(1., .3 + .9 * s1 + .45 * s2, smoothstep(.08, .3, q));

  // Pulses travelling inward along the threads, out of step from one group of threads to the next.
  float ph = d * .01 + t * .1 + 3. * noise(vec2(s * .05, top * 3. + 1.));
  float pulse = pow(.5 + .5 * cos(ph * TAU), 16.);

  // Coral bundles alternate with peach-tinted ones above, indigo with cyan below; the cool threads
  // take the rim's cyan-white as they near the center.
  vec3 warm = mix(u_colors[2].rgb, u_colors[3].rgb, mod(id, 2.) * .3 + s1 * .45);
  vec3 cool = mix(u_colors[1].rgb, u_colors[0].rgb, mix(.25, 1., mod(id, 2.)));
  float near = exp(-d / 32.);
  vec3 col = mix(cool, warm, top);
  col = mix(col, u_rim.rgb, near * s1 * .5 * (1. - top));

  // Dim at the edges, bright where the threads converge, with a white core rolling off there.
  float body = bundle * threads * (.07 + 5. * near) + pulse * (.3 + s1) * bundle * (.6 + 2.5 * near);
  vec3 glow = expose(col * body * reach, 3.2);
  glow += vec3(.4) * pow(bundle * threads * near, 2.) * reach;
  return glow;
}
`,
  maxPixels: 250_000,
  /** A moment with a pulse near the waist of each fan. */
  start: 9_500,
};
