import { getShaderColorFromString } from '@paper-design/shaders-react';
import { motion } from 'motion/react';
import { LIGHT_PALETTE } from './lights/light-design';
import { EMERGE_EASE } from './onboarding-motion';

/**
 * The glow's colors along a line, from its first glyph to its last, the horizon light's own: the
 * light cools as it writes, coral to peach to the rims' cyan-white.
 */
const CORAL = getShaderColorFromString(LIGHT_PALETTE.coral);
const PEACH = getShaderColorFromString(LIGHT_PALETTE.peach);
const RIM = getShaderColorFromString(LIGHT_PALETTE.rim);

/** Seconds a glyph takes to emerge, and its glow to fade once it has. */
const GLYPH_IN = 0.5;
const GLOW_OUT = 1.1;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The glow's color at `x` (0 to 1) along the line, at `alpha`, as a CSS color. */
function glowColor(x: number, alpha: number) {
  const [from, to, local] = x < 0.5 ? [CORAL, PEACH, x * 2] : [PEACH, RIM, x * 2 - 1];
  const channel = (index: 0 | 1 | 2) =>
    Math.round((from[index] + (to[index] - from[index]) * local) * 255);
  return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha})`;
}

/** A glyph's glow at `strength` (0 to 1) of its full size and brightness. */
function glow(x: number, scale: number, strength: number) {
  return `0 0 ${14 * scale}px ${glowColor(x, 0.85 * strength)}, 0 0 ${3 * scale}px ${glowColor(x, 0.9 * strength)}`;
}

/**
 * A line of the opening page written in by the horizon light: a typewriter whose glyphs emerge
 * one after another, evenly over `span` seconds from `at` whatever the line's length, each lit by
 * a glow in the light's colors that fades once it has emerged, so a light seems to flow along the
 * line as it writes. `glow` scales that light (1 for the title). Glyphs are graphemes, so CJK text
 * and emoji split where a reader would; assistive technology reads the whole text once.
 */
export function HeroFlowText({
  text,
  at,
  span,
  glow: scale = 1,
}: {
  text: string;
  at: number;
  span: number;
  glow?: number;
}) {
  const glyphs = Array.from(graphemes.segment(text), (part) => part.segment);
  const last = Math.max(1, glyphs.length - 1);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {glyphs.map((glyph, index) => {
          const x = index / last;
          const delay = at + x * span;
          return (
            <motion.span
              // Glyphs never reorder: a line is written once.
              key={index}
              initial={{ opacity: 0, textShadow: glow(x, scale, 1) }}
              animate={{ opacity: 1, textShadow: glow(x, scale, 0) }}
              transition={{
                opacity: { delay, duration: GLYPH_IN, ease: EMERGE_EASE },
                textShadow: { delay: delay + GLYPH_IN * 0.4, duration: GLOW_OUT, ease: 'easeOut' },
              }}
            >
              {glyph}
            </motion.span>
          );
        })}
      </span>
    </>
  );
}
