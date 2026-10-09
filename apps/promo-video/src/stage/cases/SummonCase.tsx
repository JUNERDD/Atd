import { mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { CASE_LENGTH, CHOREO } from '../../timeline.ts';
import { Layer } from '../Layer.tsx';
import { layers } from '../scene.ts';
import { arrive, useCaseTime } from './case-time.ts';

const beats = CHOREO.summon;

/**
 * The shortcut: the panel rises out of the screen's bottom-right corner, as Atd does on a Mac, and
 * the new task's welcome settles in. It stays put for the conversation, which draws over it.
 */
export function SummonCase() {
  const t = useCaseTime();
  const rise = springAt(t, beats.panel, springs.window);
  const welcome = springAt(t, beats.welcome, springs.smooth);
  const gone = t > CASE_LENGTH + 0.35 ? 0 : 1;

  return (
    <>
      <Layer
        layer={layers.main.panel}
        motion={{
          opacity: arrive(rise) * gone,
          y: mix(150, 0, rise),
          scale: mix(0.92, 1, rise),
          origin: '100% 100%',
          blur: mix(10, 0, Math.min(1, rise)),
        }}
      />
      <Layer
        layer={layers.main.welcome}
        motion={{
          opacity: arrive(welcome, 1.6) * (1 - ramp(t, CASE_LENGTH - 0.3, 0.25)),
          y: mix(14, 0, welcome),
        }}
      />
    </>
  );
}
