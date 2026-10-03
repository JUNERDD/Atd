import type { LightDesign } from './light-design';

/**
 * The screen capture page's light, prism dispersion: the capture card acts as a prism. A single
 * soft beam of slightly cool near-white light enters from the left edge, a little below the
 * middle, rises gently toward the card and narrows as it goes, slipping behind the card's left
 * edge. Out of the card's right side it leaves as a fan of five spectral bands that spread apart
 * as they travel to the right edge, ordered warm to cool from top to bottom: coral, peach, a
 * cyan-white core, cyan and indigo, with soft dark gaps between neighbors. Long silky streaks run
 * along the beam and along each band, radiating from the point inside the card where the beam
 * turns into the fan, so the bands stay straight-ish rays rather than rings.
 *
 * The composition follows the page's capture card (`art-screenshot.css`: 170 x 100 of the art's
 * unit, `min(0.4cqw, 0.75cqh)`), which the shader derives from its resolution. The fan is
 * brightest just outside the card and fades to about a third toward the right edge, measured as a
 * fraction of the room the panel has there, so it reads the same in the tall panels, where its
 * outer bands also fan out above and below the card's right half, and in the short strip, where it
 * fits beside the card. Behind the card everything is held under an eighth of full brightness, so the
 * skeleton lines, the capture frame and the permission badge stay legible.
 *
 * Motion: the fan breathes, its spread and angle swaying gently out of step; light drifts outward
 * along the beam and the bands; and a quicker shimmer runs up the beam.
 *
 * Cost: a lit pixel takes three noises in the beam and four in the fan, seven where they meet
 * behind the card; pixels beside the fan take one, and the rest of the field none.
 */
export const SCREENSHOT_LIGHT: LightDesign = {
  glsl: `
uniform vec2 u_apex;
uniform vec3 u_beam;
uniform vec2 u_fan;

vec3 light(vec2 f, vec2 p, float t) {
  // The panel's corner and the capture card's half size in square units, after the art's layout,
  // and the prism's apex inside the card, where the beam ends and the fan begins.
  float s = min(u_resolution.x, u_resolution.y);
  vec2 corner = .5 * u_resolution / s;
  vec2 card = vec2(85., 50.) * min(.004 * u_resolution.x, .0075 * u_resolution.y) / s;
  vec2 apex = u_apex * card;
  vec3 glow = vec3(0.);

  // The beam: from past the left edge, a little below the middle, to the apex. along runs 0 to 1
  // from the source to the apex; its width narrows from u_beam.y to u_beam.z on the way.
  vec2 src = vec2(-corner.x - .05, u_beam.x * corner.y);
  vec2 bd = apex - src;
  float bl = length(bd);
  bd /= bl;
  vec2 br = p - src;
  float along = dot(br, bd) / bl;
  float bw = mix(u_beam.y, u_beam.z, clamp(along, 0., 1.));
  float bx = (bd.x * br.y - bd.y * br.x) / bw;
  if (abs(bx) < 3.5 && along < 1.05) {
    // A soft core inside a wider halo, its energy gathering as it narrows.
    float core = exp(-bx * bx);
    float halo = exp(-bx * bx * .3) * .22;
    float gain = mix(.55, 1.15, along) * smoothstep(1.05, .85, along);
    // Silky streaks that converge with the beam and drift toward the card, and a shimmer racing
    // up it a little faster.
    float b1 = ridge(noise(vec2(along * bl * 1.3 - t * .12, bx * 2.6)), 3.);
    float b2 = ridge(noise(vec2(along * bl * 2.1 - t * .2, bx * 5.5 + 7.)), 5.);
    float shim = .7 + .3 * noise(vec2(along * bl * 3.5 - t * .55, t * .15));
    vec3 col = mix(u_rim.rgb, vec3(1.), .35);
    glow += mix(u_colors[0].rgb, col, .45 + .55 * core) * (core + halo) * (.5 + .45 * b1 + .3 * b2) * shim * gain;
  }

  // The fan: rays from the apex around an axis that sways a few degrees; across is the tangent off
  // the axis over the fan's half spread, so lines of equal value are straight lines through the
  // apex. The spread is set by the room at the right edge and breathes slowly.
  float ang = u_fan.x + .035 * sin(t * .09);
  vec2 ax = vec2(cos(ang), sin(ang));
  vec2 fr = p - apex;
  float rx = dot(fr, ax);
  if (rx > .02) {
    float room = corner.x - apex.x;
    float spread = clamp(u_fan.y * corner.y / room, .18, 1.1) * (1. + .08 * sin(t * .12 + 1.));
    float across = (ax.x * fr.y - ax.y * fr.x) / rx / spread;
    // A slow warp so the bands bend a little and drift; it costs the fan's first noise.
    float warp = noise(vec2(rx * 1.4 - t * .04, across * 1.5 + 3.)) - .5;
    float u = across + .14 * warp;
    if (abs(u) < 1.) {
      // Five bands across the fan, top to bottom, with soft dark gaps; the core band a touch
      // narrower in its own slot.
      float b = (.5 - .5 * u) * 5.;
      float id = clamp(floor(b), 0., 4.);
      float band = pow(sin(fract(b) * TAU * .5), id == 2. ? 2.2 : 1.5);

      // Brightest just past the card's right edge, fading to about a third at the right edge, as a
      // fraction of the room there; it rises from the apex so the fan has no bright point.
      float edge = card.x - apex.x;
      float q = clamp((rx - edge) / max(room - edge, .05), 0., 1.);
      float env = smoothstep(.02, edge * .9, rx) * mix(1., .3, pow(q, .8));

      // Silky streaks along each band, drifting outward, and a slow swell along its length.
      float s1 = ridge(noise(vec2(rx * 1.5 - t * .07, u * 24.)), 3.);
      float s2 = ridge(noise(vec2(rx * 2.4 - t * .1, u * 60. + 5.)), 5.);
      float swell = .55 + .45 * smoothstep(.2, .75, noise(vec2(rx * .9 - t * .05, id * 3.7 + 1.)));

      // Coral, peach, cyan-white, cyan, indigo. The peach leans toward coral and the core keeps cyan
      // flanks, so neither burns to grey; the deep indigo needs more light to hold its own.
      vec3 col = id < 1. ? u_colors[2].rgb
        : id < 2. ? mix(u_colors[2].rgb, u_colors[3].rgb, .55)
        : id < 3. ? mix(u_colors[0].rgb, u_rim.rgb, band)
        : id < 4. ? u_colors[0].rgb
        : u_colors[1].rgb * 1.7;
      float gain = id == 2. ? 1.6 : 1.;
      glow += col * band * env * swell * (.45 + .55 * s1 + .35 * s2) * gain * 1.5;
    }
  }

  // Behind the card the light stays under an eighth of full brightness; it ramps up just past the
  // card's border, so the card's own edge hides the transition.
  vec2 cq = abs(p) - card;
  float outside = smoothstep(-.005, .03, length(max(cq, 0.)) + min(max(cq.x, cq.y), 0.));
  return expose(glow, 2.2) * mix(.13, 1., outside);
}
`,
  /**
   * The apex as a fraction of the card's half size; the beam's entry height as a fraction of the
   * corner's, and its width at the source and at the apex; the fan's axis angle (radians) and its
   * half height at the right edge as a fraction of the corner's.
   */
  uniforms: { u_apex: [-0.15, -0.1], u_beam: [-0.3, 0.05, 0.014], u_fan: [-0.04, 0.95] },
  maxPixels: 250_000,
  start: 12_000,
};
