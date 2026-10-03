import type { LightDesign } from './light-design';

/**
 * The opening page's light, the horizon (after the Grainient hero): a field of flowing light under
 * a soft, irregular dark dome. The light runs along U-shaped flow lines that rise toward the sides,
 * bent by slow noise so the two sides differ, and gathers into a few broad ribbons with dark gaps
 * between them, each made of fine silky streaks. The ribbons alternate between the warm and the
 * cool colors, so neighbors stay in contrast. The dome darkens the field softly, without the light
 * circling it; the light is brightest just outside it, with a cyan-white edge in places.
 *
 * Its entrance (`u_entrance`): the dome opens from past the frame's corners to its rest size while
 * the ribbons stream in from both sides and slow to their drift, and the light brightens, blooming
 * briefly as it lands.
 *
 * Cost: a lit pixel takes eight noises; pixels deep in the dome return after two.
 */
export const HERO_LIGHT: LightDesign = {
  glsl: `
uniform vec2 u_center;
uniform vec2 u_radius;

vec3 light(vec2 f, vec2 p, float t) {
  // The entrance's progress (past 1 once it is over, for the bloom to fade) and its eased form.
  float run = u_entrance > 0. ? t / u_entrance : 2.;
  float e = min(run, 1.);
  float settle = 1. - pow(1. - e, 3.);

  vec2 w = vec2(noise(p * .8 + vec2(t * .025, 0.)), noise(p * .8 + vec2(5.2, -t * .02))) - .5;

  // The dome: a soft, irregular dark over the field, opening to its rest size in the entrance.
  float d = length((f - u_center) / (u_radius * mix(2.2, 1., settle)) + .45 * w);
  float open = smoothstep(.55, 1.2, d);
  if (open <= 0.) return vec3(0.);
  float near = exp(-max(d - 1., 0.) * 1.8);

  // The flow: U-shaped lines rising toward the sides, bent by the slow noise; in the entrance the
  // pattern streams in from both sides (a smooth sign, so the middle has no seam).
  float rush = (1. - settle) * 3.;
  float across = f.y - .8 * f.x * f.x + .5 * w.x;
  float along = f.x * 1.2 + .4 * w.y - rush * f.x / (abs(f.x) + .15);

  // A few broad ribbons across the flow, each dimming and brightening along its length.
  float r = across * 1.6 + .55 * noise(vec2(along * .7 + t * .02, across * .7));
  float id = floor(r + .5);
  float ribbon = pow(.5 + .5 * cos(r * TAU), 1.4);
  ribbon *= .35 + .65 * smoothstep(.2, .6, noise(vec2(along * .45 - t * .03, id * 3.1)));

  // Fine streaks inside them, along the flow.
  float s1 = ridge(noise(vec2(along * .9 + t * .05, across * 16.)), 4.);
  float s2 = ridge(noise(vec2(along * 1.4 - t * .06, across * 34. + 3.)), 6.);
  float streaks = .45 + .55 * s1 + .35 * s2;

  // Ribbons alternate between the warm and the cool family; the color switches in the dark gap.
  vec3 cool = mix(u_colors[1].rgb, u_colors[0].rgb, smoothstep(.35, .75, noise(vec2(along * .6, id) + 9.)));
  vec3 warm = mix(u_colors[2].rgb, u_colors[3].rgb, s1 * .8);
  vec3 col = mix(cool, warm, mod(id, 2.));

  // The edge's cyan-white, in places.
  float edge = exp(-pow((d - 1.02) / .07, 2.)) * smoothstep(.35, .65, noise(vec2(along * .8 + t * .03, 7.)));

  // The exposure rises through the entrance and blooms briefly as the light lands.
  float bloom = .7 * exp(-pow((run - 1.) / .12, 2.));
  vec3 glow = col * ribbon * streaks * open * (.35 + 1.1 * near);
  glow += mix(col, u_rim.rgb, .75) * edge * ribbon * streaks * .9;
  glow = expose(glow, 2. * (smoothstep(0., .6, e) + bloom));
  glow += vec3(1.) * pow(ribbon * s1, 3.) * open * near * .3 * settle;
  return glow;
}
`,
  /** The dome: wide, rising past the top edge, its floor near the bottom. */
  uniforms: { u_center: [0, 0.32], u_radius: [0.95, 1.2] },
  maxPixels: 450_000,
};
