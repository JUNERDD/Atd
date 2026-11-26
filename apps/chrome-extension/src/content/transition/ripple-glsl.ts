/**
 * `ripple`, the takeover (Atd starts working in the tab, 1.1 s): one glass ring, and a softer echo
 * behind it, rolls out of the HUD and across the tab. The ring is a smooth bump of height; its
 * slope bends the frame along the radius, blue further than red (the fringe), and its crest catches
 * the working tone. Energy rises over the first ~0.1 and drains to zero by the end, when only exact
 * texels remain. The prototype's `RIPPLE`, plus the masks (`glsl.ts`); `smoothstep(0.3, -2.5, x)`
 * is written `1 - smoothstep(-2.5, 0.3, x)`, the same curve without GLSL's undefined reversed edges.
 */
export const RIPPLE_GLSL = `
uniform float u_reach;

void main() {
  vec2 p = framePx() / u_dpr;
  float a = coverage(p);
  if (a <= 0.0) { outColor = vec4(0.0); return; }
  vec2 d = p - u_origin;
  float r = length(d);
  vec2 n = d / max(r, 1e-3);
  float t = u_t;
  float travel = 1.0 - pow(1.0 - t, 1.7);
  float R = mix(18.0, u_reach, travel);
  float w = mix(40.0, 110.0, travel);
  float energy = smoothstep(0.0, 0.1, t) * pow(1.0 - t, 1.3);

  float x1 = (r - R) / w;
  float w2 = 0.8 * w;
  float x2 = (r - 0.6 * R) / w2;
  float g1 = exp(-2.4 * x1 * x1);
  float g2 = 0.28 * exp(-2.4 * x2 * x2);
  // Behind the ring the page keeps a faint cool lift that drains as the ring leaves.
  float after = (1.0 - smoothstep(-2.5, 0.3, x1)) * energy * energy;
  if ((g1 + g2) * energy < 0.0015 && after < 0.002) { outColor = shade(exact(), a); return; }

  // d(height)/d(r) * w: positive on the inner face, negative on the outer.
  float slope = -4.8 * (x1 * g1 + x2 * g2 * (w / w2));
  float disp = slope * energy * 8.5;
  vec2 qr = p - n * disp * 0.86;
  vec2 qg = p - n * disp;
  vec2 qb = p - n * disp * 1.16;
  vec3 c = vec3(tap(qr).r, tap(qg).g, tap(qb).b);
  a = min(a, min(ghostFree(qr), min(ghostFree(qg), ghostFree(qb))));

  // Light catches the crest (just inside the ring's middle); the body carries a breath of tone.
  float crest = exp(-30.0 * (x1 + 0.08) * (x1 + 0.08)) * energy;
  float wash = 0.05 * (g1 + 0.5 * g2) * energy + 0.13 * crest + 0.035 * after;
  outColor = shade(lift(c, wash), a);
}
`;
