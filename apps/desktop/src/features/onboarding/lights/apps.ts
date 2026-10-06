import type { LightDesign } from './light-design';

/**
 * The apps page's light, the window drawn in light: the app the agent built glows from behind, as
 * if its outline were being traced. Long silky rays stand out from every edge of the window, a
 * tight bright band hugging the outline inside a softer aura, made of fine streaks that drift in
 * toward the window like light gathering into it, so the window sits in a burst of light that fans
 * out round its corners. Atd's sparkle, on the window's top right corner, splits the outline into
 * two halves that meet at the far corner in a dim gap: the warm half (coral into peach) runs left
 * along the top and down the left side, the cool half (indigo into cyan) down the right side,
 * behind the widget, and along the bottom. The sparkle's corner glows in the rims' cyan-white.
 *
 * Motion: every twelve seconds the sparkle flares and a pass sets off from it: two pens of light
 * run round the window in opposite directions, the warm one along the top and the cool one down
 * behind the widget, lengthening and heating the rays they pass and leaving a short afterglow, and
 * meet at the far corner some five seconds later, as if the app were built again, version after
 * version. Broad swells drift round the outline all the while. `start` is a moment midway through
 * a pass, the warm pen over the left of the top edge and the cool one under the window's right
 * half, which is also the still frame under Reduce Motion.
 *
 * Composition: positions are in the art's unit (`--u` in `art-illustration.css`, derived from the
 * canvas the same way), after `art-apps.css`, so the rays leave the window's own edges and the
 * glow sits under the mark at any panel size: tall bursts above and below the window in the side
 * panel, a wide one beside it in the short stacked strip. Behind the window the light goes out, so
 * its checklist stays legible, and under the mark it dims to under half, so the white sparkle stays
 * crisp; the widget is opaque and covers what passes behind it.
 *
 * Cost: a lit pixel takes three noises; pixels inside the window return before any.
 */
export const APPS_LIGHT: LightDesign = {
  glsl: `
uniform vec2 u_spark;
uniform vec4 u_window;
uniform vec2 u_pass;

// The art's unit (--u: 0.4% of the panel's width or 0.75% of its height, the smaller) in pixels.
float artUnit() {
  return min(.004 * u_resolution.x, .0075 * u_resolution.y);
}

// Where a point lies against the window, whose corners are rounded by 9 units: x is the distance
// outside it (only meaningful near and outside its edge); clockwise from the top left corner, y is
// the straight edge before the closest point of the rectangle inside the rounded corners, and z
// the turn before it in quarter turns, so a way round the outline is y plus z times a corner.
vec3 outline(vec2 a) {
  vec2 h = u_window.zw - 9.;
  vec2 rel = a - u_window.xy;
  vec2 c = clamp(rel, -h, h);
  vec2 o = rel - c;
  float d = length(o) - 9.;
  float q = 2. / 3.14159265;
  if (o.x == 0. && o.y >= 0.) return vec3(d, c.x + h.x, 0.);
  if (o.x > 0. && o.y > 0.) return vec3(d, 2. * h.x, atan(o.x, o.y) * q);
  if (o.y == 0. && o.x > 0.) return vec3(d, 2. * h.x + h.y - c.y, 1.);
  if (o.x > 0.) return vec3(d, 2. * (h.x + h.y), 1. + atan(-o.y, o.x) * q);
  if (o.x == 0.) return vec3(d, 2. * (h.x + h.y) + h.x - c.x, 2.);
  if (o.y < 0.) return vec3(d, 4. * h.x + 2. * h.y, 2. + atan(-o.x, -o.y) * q);
  if (o.y == 0.) return vec3(d, 4. * h.x + 2. * h.y + c.y + h.y, 3.);
  return vec3(d, 4. * (h.x + h.y), 3. + atan(o.y, -o.x) * q);
}

vec3 light(vec2 f, vec2 p, float t) {
  vec2 a = f * .5 * u_resolution / artUnit();
  vec3 w = outline(a);
  // Behind the window the light goes out, so its checklist stays legible.
  if (w.x < -2.) return vec3(0.);

  // The way round the outline: for the pens and the halves each corner is its own 14-unit arc;
  // for the streaks it is a 70-unit turn, so the rays fanning out round a corner keep their
  // spacing far out instead of spreading into sheets. Both start from the sparkle's corner (its
  // middle), the streaks' seam, where the halves switch under its glow.
  float edges = 4. * (u_window.z + u_window.w - 18.);
  float top = 2. * (u_window.z - 9.);
  float len = edges + 56.;
  float cw = mod(w.y + w.z * 14. - top - 7., len);
  float ct = mod(w.y + w.z * 70. - top - 35., edges + 280.);

  // The halves: cw runs clockwise from the sparkle, down the right side, ccw the other way, along
  // the top. path is the way from the sparkle by the shorter side; the halves meet at the far
  // corner, in a dim gap.
  float ccw = len - cw;
  float path = min(cw, ccw);
  float warm = smoothstep(-6., 6., cw - ccw);
  float gap = .3 + .7 * smoothstep(8., 40., .5 * len - path);

  // A pass every u_pass.x seconds: the pens leave the sparkle and run round at u_pass.y units a
  // second, each lighting the rays it passes and leaving a short afterglow.
  float tau = mod(t, u_pass.x);
  float lag = tau * u_pass.y - path;
  float pen = exp(-lag * lag / 400.) + .6 * step(0., lag) * exp(-lag / (1.6 * u_pass.y));

  // The rays: a tight band hugging the outline in a softer aura, which a passing pen lengthens;
  // long streaks across them drift in toward the window, and broad swells travel round it.
  float b = max(w.x, 0.);
  float reach = 1. + .6 * pen;
  float band = .45 * exp(-b / 4.) + .8 * exp(-b / (17. * reach)) + .15 * exp(-b / (48. * reach));
  float s1 = ridge(noise(vec2(ct * .2, b * .012 + t * .05)), 3.);
  float s2 = ridge(noise(vec2(ct * .5 + 5., b * .02 + t * .07)), 5.);
  float streaks = .35 + .65 * s1 + .3 * s2;
  float swell = .55 + .45 * smoothstep(.25, .75, noise(vec2(cw * .025 - t * .04, 3.)));

  // Coral into peach on the warm half, indigo into cyan on the cool one (the deep indigo needs
  // more light to hold its own), both heating where a pen passes, its brightest streaks taking the
  // rims' cyan-white.
  vec3 cool = mix(u_colors[1].rgb * 1.6, u_colors[0].rgb, .4 + .4 * s1 + .2 * pen);
  vec3 hot = mix(u_colors[2].rgb, u_colors[3].rgb, .25 + .5 * s1 + .25 * pen);
  vec3 col = mix(mix(cool, hot, warm), u_rim.rgb, .45 * pen * s1);
  vec3 glow = col * band * streaks * swell * gap * (.75 + 1.1 * pen);

  // The sparkle's corner glows in the rims' cyan-white and flares as each pass sets off; under the
  // mark itself the light dims, so the white mark stays crisp.
  float r = length(a - u_spark);
  glow += u_rim.rgb * exp(-r / 11.) * (.5 + .8 * exp(-tau / .8)) * smoothstep(-2., 6., w.x);
  glow = expose(glow, 2.) * mix(.45, 1., smoothstep(5., 13., r));
  return glow * smoothstep(-2., .5, w.x);
}
`,
  /**
   * The sparkle's centre, and the window's centre and half size, in art units from the art's
   * centre (y up), after `art-apps.css`; a pass's period in seconds and its pens' speed in art
   * units a second.
   */
  uniforms: { u_spark: [54, 41], u_window: [-19, 1, 73, 40], u_pass: [12, 40] },
  maxPixels: 250_000,
  start: 3_000,
};
