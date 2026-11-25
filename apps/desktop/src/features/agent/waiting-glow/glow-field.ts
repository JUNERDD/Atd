import { GLOW_FIELD_GLSL } from '@atd/ui/lib/glow/field-glsl';

/**
 * The command HUD's flowing light (`IslandGlowField.swift` in the macOS shell) as a fragment shader
 * for Paper's `ShaderMount`, shared by the panel's waiting light and live scroll control. The
 * values below mirror the shell's `IslandGlowField` and `IslandGlowStyle`; change both together.
 *
 * The field itself (the shell's drifting 6×4 mesh, sampled with a Catmull-Rom spline) is the shared
 * `GLOW_FIELD_GLSL` (`@atd/ui/lib/glow/field-glsl`). Every value is a function of the time alone,
 * so Paper's clock is the only input that moves.
 *
 * The panel's entry is drawn here too rather than by a CSS mask or transform: the canvas redraws
 * every frame the field moves, so the entry moves with it on any compositing path. With `u_entry`
 * on, the light blooms out of the composer (`u_origin`, in the box's units from its bottom left):
 * an ellipse wider than it is tall whose radius follows a critically damped spring (`ENTRY_SPRING`
 * per second), starting at rest and settling without overshoot, behind a soft rim that breathes
 * while it travels and calms as it arrives. Meanwhile the field gathers: its time runs ahead of the
 * clock at the send (about five times its pace) and eases back to it, so the light is moving as it
 * arrives instead of being uncovered. The bloom's coverage is the output's (premultiplied) alpha.
 * With `u_entry` off (Reduce Motion) the light is in from the start and keeps the clock's pace.
 *
 * With `u_fullCoverage` on, the field fills a control's own outline, as in the mini panel. The
 * waiting light's top is drawn here as well: a smootherstep falloff from `SOLID` to the box's top
 * edge, multiplied into the coverage. A linear ramp's slope jumps where it starts and where it
 * ends, and the eye reads each jump as a line (a Mach band); smootherstep's slope and curvature
 * are zero at both ends, so the light thins into the panel with no visible boundary. Raised to
 * `FALLOFF_POWER`, it holds more light through the middle and lets the faint tail reach higher,
 * so the top is wide and gentle while it still ends at zero with zero slope.
 *
 * A smooth falloff still bands: across its height the panel shows only a few dozen 8-bit levels
 * of the light (three of blue in light mode), and each step between them reads as a line. The
 * shader therefore draws the light at its final strength (`u_level`), so the canvas holds the
 * values the compositor shows, and adds a step of triangular noise to every channel there, which
 * leaves no rounding error that follows the gradient. Dithering before a CSS opacity would not do:
 * the opacity scales the noise down with the light (to 0.15 of a step in light mode) and the bands
 * return. The canvas also renders at the display's resolution (`waiting-glow.tsx`), since scaling
 * it up would smooth the noise away. CSS opacity carries only the fades, during which the bands
 * briefly return.
 */

export const GLOW_SHADER = `#version 300 es
precision highp float;

uniform float u_elapsed;
uniform float u_phase;
// The visible band may shrink inside an unchanged drawing buffer.
uniform float u_bandRatio;
// The soft upper edge recedes toward the composer before the remaining base fades.
uniform float u_retreat;
uniform float u_retreatTarget;
// Paper's vertex shader declares it at medium precision; the two declarations must match.
uniform mediump vec2 u_resolution;
// 1 while the light enters (the bloom and the field gathering); 0 when it is in from the start.
uniform float u_entry;
// A control's light fills its whole glass outline; the waiting panel keeps its bloom and falloff.
// WebGL initializes an omitted uniform to zero, preserving the panel's existing coverage.
uniform float u_fullCoverage;
// Where the bloom starts: the composer's centre, in the box's units from its bottom left.
uniform vec2 u_origin;
// The light's strength (\`glowLevel\`), drawn here so the dither below lands at the final values.
uniform float u_level;

out vec4 fragColor;
${GLOW_FIELD_GLSL}
// The bloom's spring, per second: critically damped, so it starts at rest and never overshoots.
const float ENTRY_SPRING = 9.0;
// The bloom spreads this much wider than it rises.
const float BLOOM_ASPECT = 1.6;
// The bloom's soft rim and the radius it settles at, in units of the box's width.
const float BLOOM_EDGE = 0.5;
const float BLOOM_REACH = 1.3;
// The bottom share of the box (behind the composer) at full strength; above it the light falls off.
const float SOLID = 0.2;
// The falloff's power: below 1 it keeps more light through the middle and stretches the faint tail
// higher, so the top is wider and gentler; the curve still ends at zero with zero slope.
const float FALLOFF_POWER = 0.7;

void main() {
  vec2 resolution = vec2(u_resolution.x, u_resolution.y * u_bandRatio);
  if (gl_FragCoord.y > resolution.y) { fragColor = vec4(0.0); return; }
  float since = u_elapsed;
  float phase = u_phase;

  // This pixel on the larger, drifting field (y down, as the shell lays the mesh out).
  vec2 uv = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y) / resolution;
  vec3 color = glowFieldColor(uv, phase);

  // The bloom: a spring-driven ellipse around the composer, its rim breathing until it settles.
  float bloom = 1.0;
  if (u_entry > 0.0) {
    vec2 offset = (gl_FragCoord.xy - u_origin * resolution) / resolution.x;
    offset.y *= BLOOM_ASPECT;
    float progress = 1.0 - (1.0 + ENTRY_SPRING * since) * exp(-ENTRY_SPRING * since);
    float angle = atan(offset.y, offset.x);
    float rim = (0.05 * sin(angle * 3.0 + since * 2.4) + 0.03 * sin(angle * 5.0 - since * 3.3))
      * (1.0 - 0.8 * progress);
    float radius = progress * (BLOOM_REACH + BLOOM_EDGE) + rim;
    bloom = 1.0 - smootherstep(radius - BLOOM_EDGE, radius, length(offset));
  }
  // Move only the coverage, not the field or drawing buffer: colors and pixel grain keep their
  // scale as the upper edge recedes. At rest this is exactly the original falloff.
  float top = mix(1.0, clamp(u_retreatTarget, 0.04, 0.95), u_retreat);
  float falloff = pow(
    max(1.0 - smootherstep(SOLID * top, top, gl_FragCoord.y / resolution.y), 0.0), FALLOFF_POWER);
  float coverage = u_fullCoverage > 0.0 ? 1.0 : clamp(bloom * falloff, 0.0, 1.0);
  vec4 light = vec4(color, 1.0) * coverage * u_level;
  // A step of triangular noise per channel, faded out where the light is under a step.
  vec2 p = gl_FragCoord.xy;
  vec4 grain = vec4(tpdf(p), tpdf(p + 101.0), tpdf(p + 211.0), tpdf(p + 307.0));
  fragColor = clamp(light + grain / 255.0 * min(light.a * 255.0, 1.0), 0.0, 1.0);
}
`;
