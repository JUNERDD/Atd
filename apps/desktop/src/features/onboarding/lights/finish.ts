import type { LightDesign } from './light-design';

/**
 * The closing page's light, the fountain: a few broad plumes of light rising from the bottom edge
 * like a celebratory aurora. Each plume rises straight from the floor and bends outward as it
 * climbs, so together they open like a fountain; they sway slowly, fade out in the upper part of
 * the panel, and are made of long silky streaks that travel upward, with soft dark gaps between
 * them. Warm and cool alternate side by side: a warm coral-and-peach flame under the app icon, cyan
 * plumes beside it (the tallest), and warm outer plumes past those. The flame is widest and
 * hottest at the bottom edge, where it spills over the cyan plumes' bases, and tapers as it curves
 * up to die out behind the icon. The brightest crests take a cyan-white touch. The plumes bend away
 * from the middle, so the field above and around the icon stays dark.
 *
 * Cost: a lit pixel takes five noises; pixels above every plume return after none, and those in
 * the dark above the flame and between the plumes after two.
 */
export const FINISH_LIGHT: LightDesign = {
  glsl: `
// Each form's height (the middle of its fade-out, in frame units): the flame, the inner pair (the
// tallest) and the outer pair.
uniform vec3 u_tips;

vec3 light(vec2 f, vec2 p, float t) {
  // Above the tallest plume's tip, licking included, the field is dark.
  if (f.y > u_tips.y + .37) return vec3(0.);

  // How far up the panel, 0 at the bottom edge and 1 at the top.
  float h = .5 + .5 * f.y;

  // Slow sway, anchored at the bottom and growing with height; its pattern climbs with the flow,
  // and the second term varies across the frame, so the two sides sway apart.
  vec2 w = vec2(noise(vec2(f.y * .9 - t * .09, t * .03)), noise(vec2(f.y * .7 - t * .07, 4.3 + f.x * .9 + t * .025))) - .5;

  // The flow lines leave the floor upright and bend outward as they climb: the plumes' spacing
  // grows faster than their height, so they open like a fountain.
  float fan = .55 + 1.5 * pow(h, 1.6);
  float u = f.x / fan + (.3 * w.x + .15 * w.y) * h;

  // The side plumes, one per period of r: the inner pair at 1, the outer pair at 2. The middle
  // period is left to the flame, and the light dies out past the outer pair.
  float r = u * 1.7 + .2 * (w.x + w.y);
  float side = abs(r);
  float outer = smoothstep(1.3, 1.7, side);
  float plume = pow(.5 + .5 * cos(r * TAU), 1.5) * smoothstep(.45, .85, side) * smoothstep(2.9, 2.3, side);

  // Each pair rises to its own height, licking up and down as it burns.
  float tip = mix(u_tips.y, u_tips.z, outer) + .07 * sin(r * 2.3 + t * .41) + .04 * sin(r * 3.7 - t * .67);
  plume *= 1. - smoothstep(tip - .6, tip + .25, f.y);

  // The flame: a soft profile around a center line that curves as it rises, flaring out at the
  // floor and tapering to its tip behind the icon.
  float rise = smoothstep(-1., u_tips.x + .25, f.y);
  float dx = f.x - (.09 * sin(f.y * 2.1 + t * .33) + .3 * w.y) * (.2 + rise);
  float width = mix(.34, .06, pow(rise, .6));
  float flame = exp(-dx * dx / (width * width)) * (1. - smoothstep(u_tips.x - .6, u_tips.x + .2, f.y));
  if (plume + flame < .01) return vec3(0.);

  // Long silky streaks along the flow, travelling up. Their spacing is in square units, so they
  // never stretch, of at least about half the long side, so a short, wide strip is not busier.
  float shortSide = min(u_resolution.x, u_resolution.y);
  float unit = shortSide / max(shortSide, .55 * max(u_resolution.x, u_resolution.y));
  float across = u * fan * unit * u_resolution.x / shortSide;
  float along = p.y * unit;
  float s1 = ridge(noise(vec2(across * 8., along * .45 - t * .2)), 4.);
  float s2 = ridge(noise(vec2(across * 19. + 3., along * .7 - t * .3)), 6.);
  float streaks = .3 + .7 * s1 + .35 * s2;

  // Brightness breathes along each form as bright patches travel up through it; the same noise
  // shades each plume within its family.
  float n = noise(vec2(r * 1.4 + 11., f.y * 1.1 - t * .18));
  float pulse = .5 + .5 * smoothstep(.2, .7, n);

  // Warm and cool alternate: cyan (deepening to indigo in places) for the inner pair, coral to
  // peach for the outer pair and the flame.
  vec3 cool = mix(u_colors[1].rgb, u_colors[0].rgb, .55 + .45 * smoothstep(.25, .75, n));
  vec3 warm = mix(u_colors[2].rgb, u_colors[3].rgb, .2 + .6 * smoothstep(.3, .8, n) * s1);
  vec3 hot = mix(u_colors[2].rgb, u_colors[3].rgb, .35 + .55 * s1);

  // Brightest at the bottom edge, so the fountain springs from it; the flame burns hotter still.
  float base = .4 + 1.5 * exp(-h * 3.2);
  vec3 glow = mix(cool * 1.3, warm, outer) * plume * base;
  glow += hot * flame * (.5 + 1.6 * exp(-h * 3.));
  glow *= streaks * pulse;

  // The cyan-white touch at the brightest crests.
  glow += u_rim.rgb * pow(plume * s1, 3.) * pulse * .6;
  return expose(glow, 1.8);
}
`,
  /** The heights: the flame dies out behind the icon, the inner pair rises the highest. */
  uniforms: { u_tips: [-0.05, 0.42, 0.2] },
  maxPixels: 250_000,
  start: 16000,
};
