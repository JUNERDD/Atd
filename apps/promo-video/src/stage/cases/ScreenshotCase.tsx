import { easeInOut, easeOut, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { CHOREO } from '../../timeline.ts';
import { Move } from '../../ui/Move.tsx';
import { Layer } from '../Layer.tsx';
import { layers } from '../scene.ts';
import { arrive, leaving, useCaseTime } from './case-time.ts';
import './cases.css';
import { appear, pop, wipe } from './styles.ts';

const beats = CHOREO.screenshot;
const L = layers.screenshot;
/** The captured area inside the selection layer, which also carries its size label and handles. */
const CAPTURE = {
  x: L.selection.x + 6,
  y: L.selection.y + 30,
  width: L.selection.width - 12,
  height: L.selection.height - 36,
};

/**
 * The screenshot tool: the screen dims, an area is dragged out, the toolbars slide up, and the
 * annotations land one by one (numbered steps, an arrow, a callout, a mosaic) before the capture
 * flashes.
 */
export function ScreenshotCase() {
  const t = useCaseTime();
  const windows = springAt(t, beats.windows, springs.smooth);
  const drag = ramp(t, beats.select, 0.5, easeOut);
  const out = leaving(t);
  const [step1, step2, step3] = beats.steps;
  const flash = ramp(t, beats.capture, 0.06) * (1 - ramp(t, beats.capture + 0.06, 0.4));

  return (
    <Move motion={{ opacity: 1 - out }}>
      <Layer
        layer={L.windows}
        motion={{
          opacity: arrive(windows, 1.8),
          scale: mix(0.97, 1, windows),
          origin: '720px 450px',
        }}
      />
      <Layer layer={L.dim} motion={{ opacity: ramp(t, beats.dim, 0.35, easeInOut) }} />
      <Layer
        layer={L.selection}
        motion={{
          opacity: t >= beats.select ? 1 : 0,
          clip: `inset(0 ${(1 - drag) * 100}% ${(1 - drag) * 100}% 0)`,
        }}
      />
      <Layer layer={L.bars} motion={appear(t, beats.bars, 16, springs.snappy)} />
      <Layer layer={L.step1} motion={pop(t, step1, '50% 50%', 0.2)} />
      <Layer layer={L.step2} motion={wipe(ramp(t, step2, 0.32, easeOut), 'down', 12)} />
      <Layer layer={L.step3} motion={wipe(ramp(t, step3, 0.42, easeOut), 'right', 10)} />
      <Layer layer={L.mosaic} motion={{ opacity: ramp(t, beats.mosaic, 0.3) }} />
      <Layer layer={L.hint} motion={appear(t, beats.hint, 8)} />
      <Move box={CAPTURE} motion={{ opacity: flash * 0.75 }}>
        <div className="case-flash" />
      </Move>
    </Move>
  );
}
