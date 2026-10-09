import { mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { CHOREO } from '../../timeline.ts';
import { Move } from '../../ui/Move.tsx';
import { Layer } from '../Layer.tsx';
import { layers } from '../scene.ts';
import { arrive, leaving, useCaseTime } from './case-time.ts';
import './cases.css';

const beats = CHOREO.mini;
const L = layers.mini;
/** Where the pointer comes from, relative to where it lands on Summarize. */
const POINTER_FROM = { x: 168, y: -40 };
/** The Summarize row the pointer clicks, in scene pixels. */
const ROW = { x: 1107, y: 300, width: 268, height: 27 };

/**
 * The Mini Panel: its rail slides out from the screen's edge, the saved-command menu opens, and the
 * pointer glides to Summarize and clicks.
 */
export function MiniCase() {
  const t = useCaseTime();
  const rail = springAt(t, beats.rail, springs.window);
  const menu = springAt(t, beats.menu, springs.pop);
  const glide = springAt(t, beats.pointer, { response: 0.9, damping: 0.92 });
  const press = Math.sin(Math.PI * ramp(t, beats.click, 0.22));
  const ping = Math.sin(Math.PI * ramp(t, beats.click, 0.5));
  const out = leaving(t);

  return (
    <>
      <Layer
        layer={L.flyout}
        motion={{
          opacity: arrive(menu, 2.4) * (1 - out),
          scale: [mix(0.72, 1, menu), mix(0.86, 1, menu)],
          origin: '100% 30%',
          blur: (1 - Math.min(1, menu)) * 6 + out * 4,
        }}
      />
      <Move box={ROW} motion={{ opacity: ping * (1 - out) }}>
        <div className="case-ping" />
      </Move>
      <Layer
        layer={L.rail}
        motion={{ opacity: arrive(rail, 2) * (1 - out), x: mix(96, 0, rail) + out * 96 }}
      />
      <Layer
        layer={L.pointer}
        motion={{
          opacity: ramp(t, beats.pointer, 0.2) * (1 - out),
          x: mix(POINTER_FROM.x, 0, glide),
          y: mix(POINTER_FROM.y, 0, glide),
          scale: 1 - press * 0.16,
          origin: '20% 10%',
        }}
      />
    </>
  );
}
