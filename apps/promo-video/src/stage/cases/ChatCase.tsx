import { easeInOut, mix, ramp } from '../../motion/ease.ts';
import { CHOREO } from '../../timeline.ts';
import { Move } from '../../ui/Move.tsx';
import { Layer, LayerBand } from '../Layer.tsx';
import { layers } from '../scene.ts';
import { leaving, useCaseTime } from './case-time.ts';
import { appear, pop, wipe } from './styles.ts';

const beats = CHOREO.chat;
const L = layers.chat;
/** The answer's three lines, in its layer's own pixels. */
const ANSWER_LINES = [
  [0, 19],
  [19, 43],
  [43, 64],
] as const;

/**
 * The conversation: the panel becomes the weekly recap, the follow-up pops in as a bubble, the
 * status and tool lines settle, and the answer streams line by line. Then the panel hides, as a
 * second press of the shortcut would.
 */
export function ChatCase() {
  const t = useCaseTime();
  const hide = leaving(t, 0.36, 0.46);

  return (
    <Move
      motion={{
        opacity: 1 - hide,
        y: hide * 70,
        scale: mix(1, 0.96, hide),
        origin: '1300px 860px',
      }}
    >
      <Layer layer={L.panel} motion={{ opacity: ramp(t, -0.06, 0.3, easeInOut) }} />
      <Layer layer={L.earlier} motion={appear(t, beats.earlier, 14)} />
      <Layer layer={L.ask} motion={pop(t, beats.ask, '100% 100%', 0.78)} />
      <Layer layer={L.status} motion={appear(t, beats.status, 8)} />
      <Layer layer={L.tools} motion={appear(t, beats.tools, 8)} />
      {ANSWER_LINES.map(([top, bottom], index) => (
        <LayerBand
          key={top}
          layer={L.answer}
          top={top}
          bottom={bottom}
          motion={wipe(ramp(t, beats.answer + index * 0.3, 0.42, easeInOut))}
        />
      ))}
      <Layer layer={L.actions} motion={appear(t, beats.actions, 6)} />
    </Move>
  );
}
