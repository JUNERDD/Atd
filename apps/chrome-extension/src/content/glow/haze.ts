/**
 * The mist's arrival has run its course by this, in seconds since the light came on: every pixel
 * then takes the settled path, and a frozen light may stop drawing.
 */
export const HAZE_ARRIVAL_SECONDS = 3;

/**
 * Ember Haze (烟岚), the tab's light: a soft luminous mist rising off the bottom edge and curling up
 * the sides, thinning to a faint veil along the top, with a few slow embers drifting up through it.
 * It is the prototype's `haze` option (`tmp/chrome-glow-prototypes/options/haze.js`) at its
 * default tuning. canvasui.dev's Blaze and Clouds inspired it; the GLSL is original.
 *
 * The mist is domain-warped fbm advected upward that bends the edge distances into rising tongues,
 * inside an envelope: deep off the bottom, along the sides thinning upward, a veil at the top and a
 * faint rim so the light never breaks. Its colour is one tone hue-shifted like an aurora, cooler at
 * the edge and bluer-violet as it rises. Attention calms the tongues, gathers the mist around the
 * HUD and narrows the drift to gold and amber; frozen stops the clock, so the mist holds still in
 * the drained tones. It arrives on its own: a puff out of the HUD that runs along the bottom and
 * climbs the sides. Reduce Motion drops the embers (and the clock runs slower, `TabGlow`).
 *
 * `vec4 haze(vec2 p)` returns premultiplied light for device pixel `p` before strength; it needs
 * the uniforms and helpers `shader.ts` declares ahead of it.
 */
export const HAZE_GLSL = `
const mat2 HAZE_ROTATION = mat2(0.80, -0.60, 0.60, 0.80);
// How far the mist's colour swings round the hue wheel, like an aurora (0: one tone).
const float HAZE_AURORA = 0.6;
// The arrival's spring, per second.
const float HAZE_ARRIVAL_SPRING = 3.6;
const float HAZE_ARRIVAL_END = ${HAZE_ARRIVAL_SECONDS.toFixed(1)};

// Value noise in 0..1.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// fbm with rotated octaves (hides the value-noise lattice), 0..1.
float hazeFbm(vec2 q, int octaves) {
  float v = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    v += amp * vnoise(q);
    norm += amp;
    q = HAZE_ROTATION * q * 2.03 + vec2(11.3, 7.7);
    amp *= 0.42;
  }
  return v / norm;
}

// Path length from the HUD along the edges: out along the bottom, up the sides, across the top.
float hazePath(vec2 p) {
  float W = u_res.x;
  float H = u_res.y;
  float ox = u_origin.x;
  float up = abs(p.x - ox) + max(p.y - u_origin.y, 0.0);
  float over = min(ox + p.x, 2.0 * W - ox - p.x) + H;
  return mix(up, over, smoothstep(H - 3.0 * u_band, H - 0.5 * u_band, p.y));
}

// The arrival: the mist billows out of the HUD, runs along the bottom and climbs the sides.
// Returns its mask; puff is a passing cloud around the HUD.
float hazeArrival(vec2 p, out float puff) {
  puff = 0.0;
  if (u_entry <= 0.0 || u_since > HAZE_ARRIVAL_END) return 1.0;
  float s = u_since;
  float prog = 1.0 - (1.0 + HAZE_ARRIVAL_SPRING * s) * exp(-HAZE_ARRIVAL_SPRING * s);
  float total = u_res.x + u_res.y;
  float soft = (0.28 - 0.18 * prog) * total;
  float front = prog * (total + soft) * 1.05;
  float wob = (vnoise(p / (u_dpr * 70.0) + vec2(0.0, -s * 2.0)) - 0.5) * soft;
  float mask = 1.0 - smoothstep(front - soft, front, hazePath(p) + wob);
  vec2 o = (p - u_origin) * vec2(0.8, 1.6);
  puff = exp(-length(o) / (u_band * (0.35 + 1.4 * prog))) * (1.0 - prog) * 0.9;
  return mask;
}

// A few slow embers per column of the band, drifting up and fading as the mist thins.
float hazeEmbers(vec2 c, float t, float bandCss) {
  float W = u_res.x / u_dpr;
  float H = u_res.y / u_dpr;
  float sum = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float cell = mix(66.0, 104.0, fl);
    float col = floor(c.x / cell);
    for (int k = -1; k <= 1; k++) {
      float id = col + float(k);
      vec2 seed = vec2(id, 13.0 + fl * 29.0);
      float hs = hash(seed);
      if (hs > 0.42) continue;
      float h2 = hash(seed + 7.1);
      float h3 = hash(seed + 3.7);
      float x0 = (id + 0.2 + 0.6 * h2) * cell;
      float side = 1.0 - smoothstep(0.6 * bandCss, 1.6 * bandCss, min(x0, W - x0));
      float span = mix(2.0 * bandCss, 0.55 * H, side);
      float speed = mix(15.0, 26.0, h3) * mix(1.0, 0.8, fl);
      float cycle = span / speed * 1.7;
      float life = fract(t / cycle + h2 * 7.3 + hs * 3.1) * 1.7;
      if (life > 1.0) continue;
      float y = life * span;
      float x = x0 + sin(t * 0.55 + h3 * 30.0 + y * 0.022) * (5.0 + 8.0 * h2);
      vec2 d = c - vec2(x, y);
      float r2 = dot(d, d);
      vec2 dt2 = vec2(d.x, d.y * (d.y < 0.0 ? 0.45 : 1.0));
      float size = mix(1.3, 2.1, h3) * mix(1.0, 0.8, fl);
      float core = exp(-dot(dt2, dt2) / (size * size)) * mix(0.6, 1.0, exp(-r2 / (size * size)));
      float halo = exp(-sqrt(r2) / (size * 3.0)) * 0.38;
      float fade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.5, 1.0, life));
      float tw = 0.72 + 0.28 * sin(t * 2.1 + hs * 40.0);
      sum += (core + halo) * fade * tw * mix(1.0, 0.7, fl);
    }
  }
  return sum;
}

// Soft falloff of a normalized edge distance: a smooth plateau inside, a long tail to 0 by 1.2
// (no kink, so plume crests never draw a rim).
float hazeFall(float n) {
  float f = 1.0 - smoothstep(-0.35, 1.2, n);
  return f * sqrt(f);
}

vec4 haze(vec2 p) {
  float B = u_band;
  float W = u_res.x;
  float H = u_res.y;
  float db = p.y;
  float dt = H - p.y;
  float ds = min(p.x, W - p.x);
  vec2 hudHalf = 0.5 * u_hud.zw;
  float hudE = length((p - u_hud.xy - hudHalf) / (hudHalf + B * vec2(1.3, 0.7)));
  float puff;
  float arrive = hazeArrival(p, puff);
  // Beyond these bounds every part of the envelope below is 0, so only the arrival's puff could
  // light the pixel; below the coverage cut it draws nothing, and the noise is never evaluated.
  if (db > 2.2 * B && ds > 1.4 * B && dt > 0.8 * B && (u_attention <= 0.0 || hudE > 1.6)
      && puff < 0.004) return vec4(0.0);
  if (arrive <= 0.0 && puff < 0.01) return vec4(0.0);

  vec2 c = p / u_dpr;
  float t = u_phase;
  float h = clamp(p.y / H, 0.0, 1.0);

  // Mist: domain-warped fbm, advected upward; it bends the edge distances into rising tongues.
  vec2 q = c / 190.0 * vec2(1.0, 0.82);
  vec2 lift = vec2(0.0, t * 0.1);
  vec2 w = vec2(
    hazeFbm(q * 0.6 - lift * 0.5 + vec2(t * 0.018, 0.0), 2),
    hazeFbm(q * 0.6 - lift * 0.5 + vec2(5.2, 1.3 - t * 0.013), 2));
  float m = hazeFbm(q - lift + (w - 0.5) * 2.5, 4);
  // Attention calms the plumes into a steadier glow.
  float pert = ((m - 0.5) * 1.7 + (w.y - 0.5) * 0.5) * mix(1.0, 0.6, u_attention);

  // Envelope: deep off the bottom, along the sides thinning upward, a faint veil at the top.
  float breathe = 0.85 + 0.3 * vnoise(vec2((c.x + c.y) * 0.003, t * 0.07 + 3.0));
  // Each part also fades out before the settled bounds, so no plume is ever cut by them.
  float fb = hazeFall(db / (1.45 * B * breathe) - pert) * (1.0 - smoothstep(1.4 * B, 2.2 * B, db));
  float side = smoothstep(0.02, 0.95, h);
  float fs = hazeFall(ds / (B * mix(0.95, 0.5, side) * breathe) - pert)
    * mix(1.0, 0.3, side) * (1.0 - 0.25 * u_attention) * (1.0 - smoothstep(0.8 * B, 1.4 * B, ds));
  float ft = hazeFall(dt / (0.5 * B) - pert * 0.6) * mix(0.28, 0.18, u_attention)
    * (1.0 - smoothstep(0.45 * B, 0.8 * B, dt));
  float fh = u_attention * 0.7 * hazeFall(hudE * 1.5 - 0.45 - pert)
    * (1.0 - smoothstep(1.1, 1.6, hudE));
  // A faint continuous base along the edge, so the light never breaks.
  float rim = hazeFall(min(min(db, ds) / (0.3 * B), dt / (0.2 * B))) * mix(0.4, 0.25, side);
  float f = 1.0 - (1.0 - fb) * (1.0 - fs) * (1.0 - ft) * (1.0 - fh) * (1.0 - puff) * (1.0 - rim);
  if (f < 0.004) return vec4(0.0);

  // Light inside the mist: brighter where it is dense, the warp's billows show through.
  float a = f * (0.72 + 0.8 * (m - 0.5) + 0.4 * (w.x - 0.5));
  a = clamp(a * (1.2 + 0.35 * u_attention * (1.0 - u_dark)), 0.0, 1.0) * arrive;

  // Colour: one tone, hue-shifted like an aurora (attention: a narrower gold-to-amber drift); the
  // warp's lobes add a slow hue drift.
  float k = clamp(0.55 * (1.0 - f) + 0.8 * smoothstep(0.0, 0.8, h), 0.0, 1.0);
  vec3 base = mix(mix(u_tones[0], u_tones[1], 0.55), u_tones[1], u_dark);
  float ang = HAZE_AURORA * ((k - 0.4) * 1.4 + (w.x - 0.5) * 1.8) * mix(1.0, -0.35, u_attention);
  vec3 col = clamp(hueRotate(base, ang), 0.0, 1.0);
  // Dark pages: saturate, and let the dense core glow toward the mist tone.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, max(vec3(luma) + (col - vec3(luma)) * mix(1.3, 1.08, u_attention), 0.0), u_dark);
  col = mix(col, mix(col, u_tones[2], f * f * 0.6) * 1.15, u_dark);

  // Embers: none under Reduce Motion, fewer as the light freezes.
  float em = 0.0;
  if (u_reduce < 0.5 && f > 0.04) {
    em = hazeEmbers(c, t, B / u_dpr) * (1.0 - 0.5 * u_frozen) * smoothstep(0.04, 0.35, f) * arrive;
  }
  vec3 emberColor = mix(clamp(hueRotate(u_tones[1], -0.2 * HAZE_AURORA), 0.0, 1.0),
    mix(u_tones[2], vec3(1.0), 0.4), u_dark);
  float ea = clamp(em * mix(1.5, 1.0, u_dark), 0.0, 1.0);

  // Light pages draw the embers over the mist; dark pages add both to the page.
  vec4 mist = vec4(col * a, a);
  vec4 spark = vec4(emberColor * ea, ea);
  vec4 over = spark + mist * (1.0 - ea);
  vec4 add = vec4(mist.rgb + spark.rgb, max(a, ea));
  return mix(over, add, u_dark);
}
`;
