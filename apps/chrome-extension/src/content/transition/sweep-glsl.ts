/**
 * `sweep`, at done (1.35 s): a ring-shaped band leaves the HUD's centre and runs out past the
 * farthest corner (the takeover ripple's origin and direction); drift and RGB split follow the
 * radius. Inside it the frame breaks into fine grains (3 CSS px cells) on three sheets that drift
 * at different rates (so the content spreads into a cloud, near sheets further), each grain
 * shrinking toward a dot that keeps a little of its piece of the page; the three channels read the
 * grains at offsets (the RGB split); the gaps show the page's own haze, thinned. Behind the band
 * every grain returns home at full size, which is the exact frame. A soft cool light leads the
 * front; a few near grains glint. The prototype's `SWEEP`, plus the masks (`glsl.ts`): every sample
 * a fragment reads must keep clear of the captured surfaces.
 */
export const SWEEP_GLSL = `
uniform float u_reach;
uniform float u_band;
const float CELL = 3.0;

// The nearest grain of sheet k to q (in that sheet's rest frame). Returns (distance / radius,
// home cell centre); \`at\` = (position, radius, glint hash). Every cell belongs to one sheet, and at
// e = 0 its grain fills it.
vec3 grain(vec2 q, float e, float k, out vec4 at) {
  vec2 id = floor(q / CELL);
  vec3 best = vec3(1e3, 0.0, 0.0);
  at = vec4(0.0, 0.0, 1.0, 0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = id + vec2(float(i), float(j));
      vec2 h = hash22(c);
      if (floor(h.x * 3.0) != k) continue;
      vec2 home = (c + 0.5) * CELL;
      vec2 pos = home + (hash22(c + 17.0) - 0.5) * (1.1 * CELL * e);
      float rad = CELL * mix(1.0, 0.34 + 0.26 * h.y, e);
      float dd = length(q - pos) / rad;
      if (dd < best.x) {
        best = vec3(dd, home);
        at = vec4(pos, rad, hash12(c + 5.3));
      }
    }
  }
  return best;
}

float cover(vec2 q, vec4 at, float aa) {
  float d = length(q - at.xy) / at.z;
  float w = aa / at.z;
  return 1.0 - smoothstep(1.0 - w, 1.0 + w, d);
}

void main() {
  vec2 p = framePx() / u_dpr;
  float alpha = coverage(p);
  if (alpha <= 0.0) { outColor = vec4(0.0); return; }
  float t = u_t;
  float pace = mix(t, t * t * (3.0 - 2.0 * t), 0.6);
  float front = mix(-0.15 * u_band, u_reach + 1.3 * u_band, pace);
  vec2 d = p - u_origin;
  float s = length(d);
  vec2 dir = d / max(s, 1e-3);
  vec2 side = vec2(-dir.y, dir.x);
  // The ragged front: slow noise around the circle (read on the unit direction, so it has no seam
  // where the angle wraps) plus fine grain.
  float rag = (vnoise(dir * 1.8 + vec2(0.0, u_time * 0.6)) - 0.5) * 0.12 * u_band
            + (vnoise(p * 0.06 + vec2(u_time * 2.0, 0.0)) - 0.5) * 8.0;
  float u = (front - s + rag) / u_band;
  float env = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.95, 1.0, t));
  // Grains break quickly at the front; drift starts once they have parted, and every grain is
  // home again (m = 0) while still a dot, before the grains grow back to fill their cells (e = 0).
  float e = smoothstep(0.0, 0.16, u) * (1.0 - smoothstep(0.55, 1.0, u)) * env;
  float m = smoothstep(0.06, 0.4, u) * (1.0 - smoothstep(0.4, 0.72, u)) * env;
  float lead = smoothstep(-0.1, 0.0, u) * (1.0 - smoothstep(0.0, 0.3, u)) * env;
  if (e < 0.002 && lead < 0.002) { outColor = shade(exact(), alpha); return; }

  float a = vnoise(p * 0.009 + vec2(0.0, u_time * 0.5)) * 6.2832;
  vec2 flow = (dir * 16.0 + vec2(cos(a), sin(a)) * 7.0) * m;
  vec2 split = (dir * 1.6 + side * 0.5) * e;
  float collapse = 0.75 * smoothstep(0.05, 0.5, e);
  float aa = 0.8 / u_dpr;

  // The gaps: the page's haze, thinned (paler on a light page, sunk on a dark one).
  vec2 haze = p - flow;
  vec3 blur = textureLod(u_tex, haze / u_size, 2.0 + log2(u_dpr)).rgb;
  alpha = min(alpha, ghostFree(haze));
  vec3 c = lift(mix(mix(blur, vec3(1.0), 0.2), blur * 0.55, u_dark), 0.08 * e);
  float glint = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 q = p - flow * (0.45 + 0.75 * fk);
    vec4 at;
    vec3 g = grain(q, e, fk, at);
    if (g.x > 100.0) continue;
    vec2 qr = mix(q - split, g.yz, collapse);
    vec2 qg = mix(q, g.yz, collapse);
    vec2 qb = mix(q + split, g.yz, collapse);
    vec3 col = vec3(tap(qr).r, tap(qg).g, tap(qb).b);
    alpha = min(alpha, min(ghostFree(qr), min(ghostFree(qg), ghostFree(qb))));
    vec3 k3 = vec3(cover(q - split, at, aa), cover(q, at, aa), cover(q + split, at, aa));
    c = mix(c, col, k3);
    glint = max(glint, step(0.965, at.w) * k3.g * fk * 0.5);
  }
  c = lift(c, 0.05 * e + 0.45 * glint * e + 0.14 * lead);
  outColor = shade(c, alpha);
}
`;
