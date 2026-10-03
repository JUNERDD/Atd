import type { LightDesign } from './light-design';

/**
 * The selection page's light, a highlighter sweep: one broad band of light drawn diagonally from
 * the panel's bottom-left corner to its top-right, like a highlighter stroke across a line of
 * text. The band bows faintly, has a soft, flat-topped body (ink rather than a beam), and is made
 * of long silky streaks that run along it. Its bottom-left end is warm (coral into peach), its
 * top-right end cool (indigo lit with cyan), with a cyan-white edge in places along its upper
 * side; a much fainter echo runs parallel above it in the opposite temperature, so neighbors stay
 * in contrast.
 *
 * The practice text's card sits in the panel's middle, so the band is dim there and brightens
 * only toward the two corners: the light frames the text without competing with it. The dimming
 * follows the position along the stroke, not the distance from the center, so it draws no ring.
 * The band's middle stays under a fifth of full brightness at every panel size, the short strip
 * included, where the card spans the whole height and only the ends show beside it.
 *
 * Motion: the streaks drift along the band in both directions, a shimmer travels up it, and every
 * twenty-odd seconds a soft swell sweeps the stroke from the warm end to the cool one, like the pen
 * passing again. `start` is a moment with the swell near the warm end and the cool end lit, which
 * is also the still frame under Reduce Motion.
 *
 * Cost: a lit pixel takes four or five noises; pixels well off the band, and those beside it in
 * the dim middle, return after one.
 */
export const SELECTION_LIGHT: LightDesign = {
  glsl: `
uniform float u_bow;
uniform vec2 u_width;
uniform float u_echo;
uniform float u_calm;

vec3 light(vec2 f, vec2 p, float t) {
  // The stroke's axes in square units, so it runs corner to corner at any aspect while its width
  // and streaks keep their proportions: along is -1 to 1 from corner to corner, ap the same
  // distance in square units, across the distance from the diagonal (positive toward the top-left).
  vec2 corner = .5 * u_resolution / min(u_resolution.x, u_resolution.y);
  vec2 dir = normalize(corner);
  float ap = dot(p, dir);
  float along = ap / length(corner);
  float across = dot(p, vec2(-dir.y, dir.x));

  // A slow warp and a faint bow (toward the bottom-right in the middle) keep the stroke hand-drawn.
  float w = noise(vec2(ap * .6 + t * .02, across * 1.2 - t * .015)) - .5;
  float y = across + u_bow * (1. - along * along) + .12 * w;

  // The band: a flat-topped profile, crisper on the rim side above than on the side below. The echo
  // is a narrow, faint copy above it.
  float b = abs(y) / (y > 0. ? u_width.x : u_width.y);
  float band = exp(-b * b * b);
  float e = (y - u_echo) / (u_width.x * .5);
  float echo = .22 * exp(-e * e);

  // The calm middle: dim where the text card sits, brightening toward both corners.
  float env = mix(u_calm, 1.3, smoothstep(.55, 1.1, abs(along)));
  if ((band + echo) * env < .008) return vec3(0.);

  // Silky streaks along the stroke, and a shimmer travelling up it.
  float s1 = ridge(noise(vec2(ap * .9 - t * .06, y * 22.)), 4.);
  float s2 = ridge(noise(vec2(ap * 1.5 + t * .04, y * 44. + 3.)), 6.);
  float streaks = .45 + .55 * s1 + .35 * s2;
  float shim = .55 + .45 * smoothstep(.2, .7, noise(vec2(ap * .7 - t * .08, 4.)));

  // Warm at the bottom-left end, cool at the top-right, switching in the dim middle; the warm end
  // is lifted toward its corner so it holds its own against the cyan-white. The echo takes the
  // opposite temperature.
  float k = along * .5 + .5;
  vec3 warm = mix(u_colors[2].rgb, u_colors[3].rgb, .5 * smoothstep(0., .5, k) + .5 * s1);
  warm *= 1. + .4 * smoothstep(.6, 1., -along);
  vec3 cool = mix(u_colors[1].rgb, u_colors[0].rgb, .35 + .65 * s1);
  float side = smoothstep(.38, .62, k + .2 * w);
  vec3 col = mix(warm, cool, side);
  vec3 echoCol = mix(cool, warm, side);

  // The swell: the pen passing again, warm end to cool, once every 22.5 seconds; it wraps while
  // off the frame.
  float phase = mod(t * .16, 3.6) - 1.8;
  float sw = (along - phase) / .35;
  float swell = .5 * exp(-sw * sw);

  vec3 glow = (col * band * shim + echoCol * echo) * streaks * env * (1. + swell);

  // The cyan-white edge along the band's upper side, in places.
  float r = (y - u_width.x * .85) / .025;
  if (r * r < 9.) {
    float rim = exp(-r * r) * smoothstep(.35, .65, noise(vec2(ap * .8 + t * .03, 7.)));
    glow += mix(col, u_rim.rgb, .75) * rim * streaks * env * .8;
  }

  glow = expose(glow, 2.6);
  // The brightest streaks roll off to white, only toward the corners.
  float hot = band * s1;
  glow += vec3(.25) * hot * hot * hot * env * env;
  return glow;
}
`,
  /** The stroke: nearly straight, its upper side crisper than its lower, the echo well above it. */
  uniforms: { u_bow: 0.04, u_width: [0.2, 0.32], u_echo: 0.55, u_calm: 0.1 },
  maxPixels: 250_000,
  start: 8000,
};
