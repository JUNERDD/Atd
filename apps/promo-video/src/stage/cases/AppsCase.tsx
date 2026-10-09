import { mix } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { CHOREO } from '../../timeline.ts';
import { Move } from '../../ui/Move.tsx';
import { Layer } from '../Layer.tsx';
import { layers } from '../scene.ts';
import { arrive, leaving, useCaseTime } from './case-time.ts';

const beats = CHOREO.apps;
const L = layers.apps;
/** The Create app button, in scene pixels: the Notes window grows out of it. */
const CREATE = { x: 444, y: 707 };

/**
 * My apps: the list rises into place, then Notes, an app made in a conversation, opens as its own
 * window, growing out of the Create app button.
 */
export function AppsCase() {
  const t = useCaseTime();
  const list = springAt(t, beats.list, springs.window);
  const launch = springAt(t, beats.launch, { response: 0.6, damping: 0.78 });
  const out = leaving(t);

  return (
    <Move
      motion={{ opacity: 1 - out, scale: mix(1, 0.96, out), origin: '720px 450px', blur: out * 6 }}
    >
      <Layer
        layer={L.list}
        motion={{
          opacity: arrive(list, 2.2),
          y: mix(110, 0, list),
          scale: mix(0.94, 1, list),
          origin: '50% 100%',
        }}
      />
      <Layer
        layer={L.notes}
        motion={{
          opacity: arrive(launch, 2.6),
          scale: mix(0.12, 1, launch),
          origin: `${CREATE.x - L.notes.x}px ${CREATE.y - L.notes.y}px`,
          blur: (1 - Math.min(1, launch)) * 10,
        }}
      />
    </Move>
  );
}
