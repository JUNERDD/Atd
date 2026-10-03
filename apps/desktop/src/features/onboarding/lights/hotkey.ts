import type { LightDesign } from './light-design';

/**
 * The shortcut page's light, keystroke trails: a long exposure of fast motion. Horizontal trails
 * race across the panel in two broad bands, a cool one above the keycaps and a warm one below,
 * with a dark channel between them where the keycaps sit. A gentle perspective draws the trails
 * toward a vanishing point at the keycaps' center, so the bands fan out toward the sides and
 * dim toward the middle, as distance would.
 *
 * Each band is a stack of lanes, grouped into a few bundles that brighten and dim along their
 * length, over a sheet of fine silky fibers. A lane carries streaks with a soft head and a long
 * fading tail, each lane at its own speed and spacing, and the brightest heads burn to a
 * cyan-white core. Tails sit in the band's deep tone (indigo, coral) and heads heat to its bright
 * one (cyan, peach). The two bands stream steadily in opposite directions, like the lanes of a road
 * at night, so the motion has no seam where the perspective folds.
 *
 * Cost: a lit pixel takes four noises and two hashes; the channel and the dark past the bands
 * return before any noise, and the bands' dim fringes after one.
 */
export const HOTKEY_LIGHT: LightDesign = {
  glsl: `
uniform vec2 u_band;
uniform float u_fan;

// One band's streaks across its lanes: x along the trails, y across them, in square units.
// dir is the travel direction (+1 right, -1 left). Returns the trail and its hottest core.
vec2 trails(float x, float y, float t, float dir, float seed) {
  float lane = y * 38. + seed;
  float id = floor(lane);
  float r1 = hash(vec2(id, seed));
  float r2 = fract(r1 * 37.3);
  // The lane's soft profile across: wide enough that neighbors blend into a silky sheet.
  float across = exp(-pow((fract(lane) - .5) / .3, 2.)) * mix(.3, 1., r2 * r2);

  // Streaks along the lane: a sawtooth with a soft head at its leading end and a tail fading
  // behind it. Each lane has its own speed and spacing; some streaks are missing altogether.
  float period = mix(.9, 2.2, r2);
  float speed = mix(.22, .55, r1);
  float s = (x * dir - t * speed) / period + r2 * 9.;
  float inst = floor(s);
  float ph = fract(s);
  float head = 1. - smoothstep(.93, 1., ph);
  float tail = pow(ph, mix(1.6, 4., r1));
  float ri = hash(vec2(inst, id + seed));
  float present = step(.4, ri);
  float bright = .25 + .95 * pow(fract(ri * 23.7), 2.);
  float streak = tail * head * present * bright;

  // The hottest heads: a narrow core in the lane's middle, only on the brightest streaks.
  float core = pow(tail * head, 3.) * present * smoothstep(.8, 1.1, bright) * pow(across, 4.);
  return vec2(streak * across, core);
}

vec3 light(vec2 f, vec2 p, float t) {
  // The perspective: lines of constant height spread from the vanishing point at the center,
  // straight toward each side (a curve would read as the hero's U), rounded through the middle.
  float persp = 1. + u_fan * sqrt(f.x * f.x + .08);
  float af = f.y / persp;
  float ap = p.y / persp;
  float up = step(0., af);
  // The channel and the dark past the bands' outer edges, before any noise.
  if (abs(af) < .12 || abs(abs(af) - u_band.x) > 2.1 * u_band.y + .03) return vec3(0.);

  // Each band's envelope across the frame, breathing slowly along its length.
  float bend = noise(vec2(p.x * .6 + t * .03, up * 11.)) - .5;
  float band = exp(-pow((abs(af) - u_band.x - .06 * bend) / u_band.y, 2.));
  // The channel under the keycaps stays dark, its edge soft.
  band *= smoothstep(.12, .4, abs(af));
  // Toward the vanishing point the trails thin and dim, as distance would.
  float k = band * (.22 + .78 * smoothstep(.02, .9, abs(f.x)));
  if (k < .015) return vec3(0.);

  float dir = up * 2. - 1.;
  vec2 tr = trails(p.x, ap, t, dir, up * 31.);

  // Bundles: groups of lanes that brighten and dim along their length.
  float bundle = smoothstep(.25, .75, noise(vec2(p.x * .7 - dir * t * .06, ap * 5. + up * 17.)));

  // Silky fibers inside the bands, long along the trails and fine across them, in two scales.
  float s1 = ridge(noise(vec2(p.x * 1.1 - dir * t * .25, ap * 34.)), 3.);
  float s2 = ridge(noise(vec2(p.x * 1.7 - dir * t * .4, ap * 90. + 5.)), 5.);
  float silk = .35 + .5 * s1 + .35 * s2;

  // Tails cool to the deep tone of their family, heads heat to its bright one.
  float heat = smoothstep(0., .7, tr.x + .3 * s1 * bundle);
  vec3 cool = mix(u_colors[1].rgb, u_colors[0].rgb, .45 + .55 * heat);
  vec3 warm = mix(u_colors[2].rgb, u_colors[3].rgb, .1 + .8 * heat);
  // The cool family is darker than the warm one; it takes more light to hold its own.
  vec3 col = mix(warm, cool * 1.55, up);

  // The band: a sheet of fibers, lit more where a bundle passes, with the streaks racing over it.
  float sheet = (.2 + .8 * bundle) * silk;
  vec3 glow = col * k * (.5 * sheet + 5. * tr.x * (.5 + .5 * silk) * (.3 + .7 * bundle));
  glow += u_rim.rgb * tr.y * k * 5.;
  return expose(glow, 3.);
}
`,
  /**
   * The bands' height from the center line and their half-width, in the frame's axes, and how
   * much the perspective spreads them toward the sides.
   */
  uniforms: { u_band: [0.56, 0.24], u_fan: 0.28 },
  maxPixels: 250_000,
  start: 20_000,
};
