import type { LightDesign } from './light-design';

/**
 * The welcome page's light, an eclipse corona: the app icon sits like a dark disc, and four long
 * silky plumes stream out from just around it toward the frame's corners, each an open arc that
 * curls like a slow solar prominence, so together they read as a loose pinwheel rather than a ring.
 * The plumes leave the core between dark gaps, white-hot with a cyan-white touch where they emerge,
 * and fade and thin toward the corners. The right side is warm (peach cooling to coral above, coral
 * with peach streaks below) and the left cool (cyan deepening to indigo above, indigo with cyan
 * streaks below), so every plume's neighbor across the icon is its opposite. No two plumes share a
 * length, width or weight, which keeps the pinwheel from reading as a logo.
 *
 * The core follows the icon's own sizing (`--u` in `art-illustration.css`), so the plumes start
 * just past the tile at every panel size. The angle is taken halfway between the frame's axes and
 * square units: the plumes still aim at the corners, and in the wide, short strip they stay broad
 * curls beside the icon instead of thin lines squeezed toward the horizontal.
 *
 * Motion: the streaks flow outward along each plume and its course wavers, while the whole
 * pinwheel sways back and forth by a few degrees over minutes, so the composition never drifts away.
 *
 * Cost: a lit pixel takes four noises; the core and the gaps between plumes return after at most one.
 */
export const WELCOME_LIGHT: LightDesign = {
  glsl: `
uniform float u_bend;
uniform vec4 u_offset;
uniform vec4 u_len;
uniform vec4 u_width;
uniform vec4 u_weight;

vec3 light(vec2 f, vec2 p, float t) {
  // The core: the icon's visible tile (its box is 92 --u wide, the art's 176px cap approximated, and
  // the tile is inset 7.81% in it), in square units; r counts tile half-widths from the center.
  float iconW = min(92. * min(.004 * u_resolution.x, .0075 * u_resolution.y) / min(u_resolution.x, u_resolution.y), .34);
  float r = length(p) / (.42 * iconW);
  if (r < .9) return vec3(0.);

  // The pinwheel: four angular slots, each bent with distance so its plume curls, set so the plumes
  // reach the corners; the whole sways slowly. d is the offset across a plume, in slots (-.5 to .5).
  float rf = length(f);
  float rot = .3 * sin(t * .03);
  vec2 q = f * sqrt(u_resolution / min(u_resolution.x, u_resolution.y));
  float x = (atan(q.y, q.x) - rot - u_bend * rf - (TAU / 8. - 1.2 * u_bend)) / (TAU / 4.);
  float id = mod(floor(x + .5), 4.);
  vec4 k = vec4(equal(vec4(id), vec4(0., 1., 2., 3.)));
  float d = x - floor(x + .5) - dot(u_offset, k);
  d += .1 * (noise(vec2(rf * 1.6 - t * .05, id * 4.7)) - .5);

  // Each plume tapers from its base to its tip and fades out before its slot's edge, so the
  // neighbors never meet; one edge is crisper than the other, like light swept by the turn.
  float len = dot(u_len, k);
  float hw = mix(.15, .055, smoothstep(.1, len, rf)) * dot(u_width, k);
  if (abs(d) > hw * 2.6) return vec3(0.);
  float profile = exp(-pow(d / hw, 2.) * (d > 0. ? 1.5 : .8));
  float haze = exp(-pow(d / hw, 2.) * .55) * .2;

  // Fine streaks along the plume, flowing outward; across is in distance rather than angle, so the
  // streaks keep their spacing instead of crowding together at the base.
  float across = d * (rf + .35);
  float s1 = ridge(noise(vec2(rf * 1.2 - t * .08, across * 30. + id * 5.)), 4.);
  float s2 = ridge(noise(vec2(rf * 2. - t * .11, across * 64. + 2.)), 6.);
  float streaks = .4 + .6 * s1 + .35 * s2;
  float swell = .45 + .55 * smoothstep(.25, .75, noise(vec2(rf * .9 - t * .05, id * 3.1)));

  // Brightest just past the tile, dimming toward the corners and gone at the plume's length.
  float rise = smoothstep(.95, 1.35, r);
  float near = exp(-max(r - 1.3, 0.) * .45);
  float tip = 1. - smoothstep(len * .55, len, rf);

  // Warm on the right (slots 0 and 3), cool on the left; the upper plumes cool along their length.
  float g = smoothstep(.2, 1.1, rf);
  vec3 col;
  if (id < .5) col = mix(u_colors[3].rgb, u_colors[2].rgb, g);
  else if (id < 1.5) col = mix(u_colors[0].rgb, u_colors[1].rgb, g);
  else if (id < 2.5) col = mix(u_colors[1].rgb, u_colors[0].rgb, s1 * .6) * mix(1., .8, g);
  else col = mix(u_colors[2].rgb, u_colors[3].rgb, s1 * .5);
  col = mix(col, u_rim.rgb, .7 * exp(-pow((r - 1.2) / .16, 2.)));

  float body = (profile * streaks + haze) * swell * rise * near * tip * dot(u_weight, k);
  vec3 glow = expose(col * body * (1.3 + 1.8 * near), 2.2);
  glow += vec3(1.) * pow(profile * s1, 3.) * rise * near * tip * .25;
  return glow;
}
`,
  /**
   * The curl (radians of turn across the frame) and, per plume (right-top, left-top, left-bottom,
   * right-bottom), its shift within its slot, its length (frame radius), its width and its weight.
   */
  uniforms: {
    u_bend: 1.05,
    u_offset: [0.03, -0.04, 0.05, -0.02],
    u_len: [1.2, 1.45, 1.15, 1.5],
    u_width: [0.9, 1.1, 0.85, 1.15],
    u_weight: [1.1, 1, 0.8, 1.2],
  },
  maxPixels: 250_000,
  /** A moment with the four plumes in balance, the warm upper plume at its brightest. */
  start: 45_000,
};
