import { useMemo, useRef } from 'react';
import { ShaderMount, type PaperShaderElement } from '@paper-design/shaders-react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@atd/ui/lib/utils';
import { useShaderClock } from '../../components/use-shader-clock';
import { LIGHT_COLORS, LIGHT_RIM, lightShader, type LightDesign } from './lights/light-design';
import './guide-light.css';

/**
 * The light's frame interval: its motion is slow, so 60 frames a second look the same as a
 * ProMotion display's 120 and cost half.
 */
const FRAME_MS = 1000 / 60;

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
 * One of the guide's lights (`lights/`) filling its box, with film grain masked onto it: the
 * opening page's full-screen light or a step's art panel backdrop. It is transparent where it is
 * dark; the host decides what shows through. `entrance` is the length of the design's entrance in
 * seconds (none by default). Paper's own loop stays paused and `useShaderClock` drives it from the
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
  useShaderClock(ref, start, !reduced, FRAME_MS);
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
