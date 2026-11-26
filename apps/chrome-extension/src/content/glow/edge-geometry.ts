/**
 * Where a pixel sits relative to the tab's edge, for the light's shader: the tab is a rectangle
 * with rounded corners (`u_radius`), and each helper is in device px from the bottom left. The
 * prototype's harness (`tmp/chrome-glow-prototypes/harness/runner.js`, its `perimeterS` and
 * `perimeterLength`) and its Glyph Stream option (`glyphDepth`, `glyphFlow`, `glyphWrap`) define
 * them; the light depends on their exact values, so change them only together with it.
 *
 * Needs `u_res`, `u_radius` and `PI` declared ahead of it.
 */
export const EDGE_GEOMETRY_GLSL = `
// Signed depth into the rounded tab, device px: > 0 inside, 0 on the edge.
float edgeDepth(vec2 p) {
  vec2 h = u_res * 0.5;
  vec2 q = abs(p - h) - (h - vec2(u_radius));
  return -(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius);
}

// Total length of the rounded edge, device px.
float perimeterLength() {
  float r = u_radius;
  return 2.0 * (u_res.x - 2.0 * r) + 2.0 * (u_res.y - 2.0 * r) + 2.0 * PI * r;
}

// Arc-length position of the nearest edge point, device px, clockwise from the top-left corner's
// end of the top edge (0 .. perimeterLength()). Continuous along the edge; deep inside the tab
// (farther than the corner radius) it has seams on the diagonals.
float perimeterS(vec2 p) {
  vec2 q = vec2(p.x, u_res.y - p.y);
  float W = u_res.x;
  float H = u_res.y;
  float r = max(u_radius, 1.0);
  float top = W - 2.0 * r;
  float side = H - 2.0 * r;
  float a = 0.5 * PI * r;
  if (q.x > W - r && q.y < r) {
    vec2 d = q - vec2(W - r, r);
    return top + (atan(d.y, d.x) + 0.5 * PI) / (0.5 * PI) * a;
  }
  if (q.x > W - r && q.y > H - r) {
    vec2 d = q - vec2(W - r, H - r);
    return top + a + side + atan(d.y, d.x) / (0.5 * PI) * a;
  }
  if (q.x < r && q.y > H - r) {
    vec2 d = q - vec2(r, H - r);
    return 2.0 * top + 2.0 * a + side + (atan(d.y, d.x) - 0.5 * PI) / (0.5 * PI) * a;
  }
  if (q.x < r && q.y < r) {
    vec2 d = q - vec2(r, r);
    return 2.0 * top + 3.0 * a + 2.0 * side + (atan(d.y, d.x) + PI) / (0.5 * PI) * a;
  }
  float dt = q.y;
  float dr = W - q.x;
  float db = H - q.y;
  float dl = q.x;
  float m = min(min(dt, dr), min(db, dl));
  if (m == dt) return q.x - r;
  if (m == dr) return top + a + (q.y - r);
  if (m == db) return top + 2.0 * a + side + (W - r - q.x);
  return 2.0 * top + 3.0 * a + side + (H - r - q.y);
}

// Signed flow coordinate of the nearest edge point: arc length from the top centre, positive
// clockwise (the right half), negative anticlockwise (the left half). L is perimeterLength().
float edgeFlow(vec2 p, float L) {
  float d = perimeterS(p) - (0.5 * u_res.x - u_radius);
  return mod(d + 0.5 * L, L) - 0.5 * L;
}

// The distance along the edge that a flow difference d stands for, the shorter way round.
float edgeWrap(float d, float L) {
  return abs(mod(d + 0.5 * L, L) - 0.5 * L);
}
`;
