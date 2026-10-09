import { mix } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { Move } from '../../ui/Move.tsx';
import { Layer, LayerBand } from '../Layer.tsx';
import type { SceneLayer } from '../scene.ts';
import { arrive, leaving, useCaseTime } from './case-time.ts';
import { appear } from './styles.ts';

interface WindowCaseProps {
  window: SceneLayer;
  page: SceneLayer;
  /** Where the page splits into rows, top to bottom, in its own pixels. */
  rows: readonly number[];
  beats: { window: number; rows: number };
  /** The last case on the screen leaves with the screen itself, so it does not close first. */
  closes?: boolean;
}

/**
 * A settings page: the window opens from its center on a spring, then the page fills in row by row.
 * Used by both Models and Automations, which share the settings window.
 */
export function WindowCase({ window, page, rows, beats, closes = true }: WindowCaseProps) {
  const t = useCaseTime();
  const open = springAt(t, beats.window, springs.window);
  const out = closes ? leaving(t) : 0;

  return (
    <Move
      motion={{
        opacity: arrive(open, 2.4) * (1 - out),
        scale: mix(0.9, 1, open) * mix(1, 0.95, out),
        origin: `${window.x + window.width / 2}px ${window.y + window.height / 2}px`,
        blur: (1 - Math.min(1, open)) * 8 + out * 6,
      }}
    >
      <Layer layer={window} />
      {rows.slice(1).map((bottom, index) => (
        <LayerBand
          key={bottom}
          layer={page}
          top={rows[index] ?? 0}
          bottom={bottom}
          motion={appear(t, beats.rows + Math.min(index, rows.length - 3) * 0.075, 16)}
        />
      ))}
    </Move>
  );
}
