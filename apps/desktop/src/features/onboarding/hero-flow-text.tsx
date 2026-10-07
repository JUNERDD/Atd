import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { getShaderColorFromString } from '@paper-design/shaders-react';
import { motion } from 'motion/react';
import { LIGHT_PALETTE } from './lights/light-design';
import { EMERGE_EASE, FADE_EASE } from './onboarding-motion';

/**
 * The glow's colors over the light's run, the horizon light's own: the light cools as it writes,
 * coral to peach to the rims' cyan-white.
 */
const CORAL = getShaderColorFromString(LIGHT_PALETTE.coral);
const PEACH = getShaderColorFromString(LIGHT_PALETTE.peach);
const RIM = getShaderColorFromString(LIGHT_PALETTE.rim);

/**
 * Seconds a glyph takes to emerge (on `EMERGE_EASE`). Its glow starts to fade as it lands,
 * `GLOW_AT` of the way through, and fades over `GLOW_OUT` seconds on `FADE_EASE`: each glyph is
 * brightest as the light writes it, and the light's trail dims evenly behind.
 */
const GLYPH_IN = 0.5;
const GLOW_AT = 0.8;
const GLOW_OUT = 1.1;

/**
 * How far across the row above the light is when a row starts, as a share of the line's width:
 * the rows are written in one diagonal sweep, from the top left to the bottom right, neither all
 * at once nor one after another (which would send the light back to the left at each row).
 */
const ROW_LAG = 0.4;

/**
 * The light's travel along its way, position against time: CSS's `ease`, which sets off at 0.4 of
 * its mean speed and settles slowly. A gentler start (the sine `S`) leaves the first glyph alone
 * under its own slow emergence, and a quicker one (`RISE_EASE`) shows the first words almost at
 * once and then drags.
 */
const TRAVEL_EASE = [0.25, 0.1, 0.25, 1] as const;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** One coordinate of a cubic-bezier from (0, 0) to (1, 1) with control values `a` and `b`. */
function bezier(a: number, b: number, s: number) {
  return 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
}

/**
 * When the light reaches `p` (0 to 1) of its way, as a share of its time: `TRAVEL_EASE` read
 * backwards, its curve parameter found by bisection on the position.
 */
function reachedAt(p: number) {
  const [x1, y1, x2, y2] = TRAVEL_EASE;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    if (bezier(y1, y2, middle) < p) low = middle;
    else high = middle;
  }
  return bezier(x1, x2, (low + high) / 2);
}

/** The glow's color at `u` (0 to 1) of the light's run, at `alpha`, as a CSS color. */
function glowColor(u: number, alpha: number) {
  const [from, to, local] = u < 0.5 ? [CORAL, PEACH, u * 2] : [PEACH, RIM, u * 2 - 1];
  const channel = (index: 0 | 1 | 2) =>
    Math.round((from[index] + (to[index] - from[index]) * local) * 255);
  return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${alpha})`;
}

/** A glyph's glow at `strength` (0 to 1) of its full size and brightness. */
function glow(u: number, scale: number, strength: number) {
  return `0 0 ${14 * scale}px ${glowColor(u, 0.85 * strength)}, 0 0 ${3 * scale}px ${glowColor(u, 0.9 * strength)}`;
}

/** When the light reaches each glyph of `text`, and when that was measured. */
interface GlyphTimes {
  text: string;
  /** Each glyph's moment, as a share (0 to 1) of the line's `span`. */
  times: number[];
  /** Seconds from the line's mount to the measurement, which the glyphs' delays make up. */
  elapsed: number;
}

/**
 * Measures where each glyph sits once the line's font has loaded (before that, a fallback font's
 * metrics could wrap the line elsewhere) and times the light's way over them: across each row by
 * the glyph's centre in the line's box, each row starting `ROW_LAG` behind the one above, the
 * whole way eased by `reachedAt`. A row is found by its top: a glyph more than half its height
 * below its row's top starts the next one. The mount time stays put if the text changes, as the
 * line's timing counts from it.
 */
function useGlyphTimes(line: RefObject<HTMLSpanElement | null>, text: string) {
  const [measured, setMeasured] = useState<GlyphTimes | null>(null);
  const mountedAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = line.current;
    if (!element) return;
    const start = (mountedAt.current ??= performance.now());
    const style = getComputedStyle(element);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    let current = true;
    void document.fonts.load(font, text).then(() => {
      if (!current) return;
      const boxes = Array.from(element.children, (glyph) => glyph.getBoundingClientRect());
      let row = 0;
      let rowTop = boxes[0]?.top ?? 0;
      const places = boxes.map((box) => {
        if (box.top - rowTop > box.height / 2) {
          row += 1;
          rowTop = box.top;
        }
        return { row, center: box.left + box.width / 2 };
      });
      const left = Math.min(...places.map((place) => place.center));
      const width = Math.max(...places.map((place) => place.center)) - left;
      const way = 1 + ROW_LAG * row;
      setMeasured({
        text,
        times: places.map((place) => {
          const across = width > 0 ? (place.center - left) / width : 0;
          return reachedAt((across + ROW_LAG * place.row) / way);
        }),
        elapsed: (performance.now() - start) / 1000,
      });
    });
    return () => {
      current = false;
    };
  }, [line, text]);
  return measured?.text === text ? measured : null;
}

/**
 * A line of the opening page written in by the horizon light, over `span` seconds from `at`
 * whatever its length: its glyphs emerge as the light passes over them, left to right along each
 * row, the rows following one another in a diagonal sweep, each glyph lit by a glow in the
 * light's colors that fades as it lands, so a light seems to flow through the line as it writes. `glow` scales that light (1 for the title). Glyphs are graphemes, so CJK text and emoji
 * split where a reader would; they stay hidden until the light's way over them is measured.
 * Assistive technology reads the whole text once.
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
  const line = useRef<HTMLSpanElement>(null);
  const measured = useGlyphTimes(line, text);
  const glyphs = Array.from(graphemes.segment(text), (part) => part.segment);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span ref={line} aria-hidden>
        {glyphs.map((glyph, index) => {
          const u = measured?.times[index];
          // Glyphs never reorder: a line is written once.
          if (measured === null || u === undefined)
            return (
              <span key={index} className="opacity-0">
                {glyph}
              </span>
            );
          const delay = Math.max(0, at + u * span - measured.elapsed);
          return (
            <motion.span
              key={index}
              initial={{ opacity: 0, textShadow: glow(u, scale, 1) }}
              animate={{ opacity: 1, textShadow: glow(u, scale, 0) }}
              transition={{
                opacity: { delay, duration: GLYPH_IN, ease: EMERGE_EASE },
                textShadow: {
                  delay: delay + GLYPH_IN * GLOW_AT,
                  duration: GLOW_OUT,
                  ease: FADE_EASE,
                },
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
