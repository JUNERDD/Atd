import { easeInOut, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { CHOREO } from '../../timeline.ts';
import { Move } from '../../ui/Move.tsx';
import { Layer } from '../Layer.tsx';
import { layers } from '../scene.ts';
import { arrive, leaving, useCaseTime } from './case-time.ts';
import { pop, wipe } from './styles.ts';

const beats = CHOREO.selection;
const L = layers.selection;

/**
 * The selection toolbar: a note opens, a phrase is dragged across, and the toolbar pops up beside
 * it with Ask Atd, Translate, Summarize and Explain.
 */
export function SelectionCase() {
  const t = useCaseTime();
  const page = springAt(t, beats.page, springs.window);
  const out = leaving(t);

  return (
    <Move
      motion={{
        opacity: arrive(page, 2.2) * (1 - out),
        scale: mix(0.94, 1, page) * mix(1, 0.97, out),
        origin: '720px 450px',
        blur: out * 6,
      }}
    >
      <Layer layer={L.page} />
      <Layer
        layer={L.highlight}
        motion={wipe(ramp(t, beats.highlight, 0.5, easeInOut), 'right', 4)}
      />
      <Layer layer={L.text} />
      <Layer layer={L.toolbar} motion={pop(t, beats.toolbar, '50% 100%', 0.6)} />
    </Move>
  );
}
