import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { ShaderMount, type PaperShaderElement } from '@paper-design/shaders-react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@atd/ui/lib/utils';
import { LIGHT_COLORS, LIGHT_RIM, lightShader, type LightDesign } from './lights/light-design';
import './guide-light.css';

/**
 * The light's frame interval: its motion is slow, so 60 frames a second look the same as a
 * ProMotion display's 120 and cost half.
 */
const FRAME_MS = 1000 / 60;

/** The longest step the clock takes, so the light resumes where it paused after a hidden spell. */
const MAX_STEP_MS = 50;

/** Each design's whole shader, built once. */
const shaders = new WeakMap<LightDesign, string>();
function shaderOf(design: LightDesign) {
  let shader = shaders.get(design);
  if (shader === undefined) {
    shader = lightShader(design);
    shaders.set(design, shader);
  }
  return shader;
}

/**
 * Advances the paused shader at most 60 times a second, from `start` ms of the light's time.
 * WebKit stops animation frames while the window is hidden, and each step is at most
 * `MAX_STEP_MS`, so the light pauses with the window instead of jumping when it returns.
 */
function useCappedClock(ref: RefObject<PaperShaderElement | null>, start: number, run: boolean) {
  useEffect(() => {
    if (!run) return;
    let frame = 0;
    let clock = start;
    let last = performance.now();
    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      // Two milliseconds of slack, so a 60 Hz display's own frames are never skipped.
      if (now - last < FRAME_MS - 2) return;
      clock += Math.min(now - last, MAX_STEP_MS);
      last = now;
      // Paper sets the mount up once it has processed the uniforms, a moment after the first render.
      ref.current?.paperShaderMount?.setFrame(clock);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref, start, run]);
}

/**
 * One of the guide's lights (`lights/`) filling its box, with film grain masked onto it: the
 * opening page's full-screen light or a step's art panel backdrop. It is transparent where it is
 * dark; the host decides what shows through. `entrance` is the length of the design's entrance in
 * seconds (none by default). Paper's own loop stays paused and `useCappedClock` drives it from the
 * design's `start`; under Reduce Motion the light is a still frame there, past its entrance.
 */
export function GuideLight({
  design,
  entrance = 0,
  className,
}: {
  design: LightDesign;
  entrance?: number;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<PaperShaderElement>(null);
  // One object per design and entrance: `ShaderMount` re-sends its uniforms when this changes.
  const uniforms = useMemo(
    () => ({
      ...design.uniforms,
      u_entrance: entrance,
      u_colors: LIGHT_COLORS,
      u_rim: LIGHT_RIM,
    }),
    [design, entrance],
  );
  const start = (design.start ?? 0) + (reduced ? entrance * 1000 : 0);
  useCappedClock(ref, start, !reduced);
  return (
    <div aria-hidden className={cn('guide-light', className)}>
      <ShaderMount
        ref={ref}
        className="guide-light-canvas"
        fragmentShader={shaderOf(design)}
        uniforms={uniforms}
        speed={0}
        frame={start}
        minPixelRatio={1}
        maxPixelCount={design.maxPixels}
      />
    </div>
  );
}
