import { clamp01 } from '../../motion/ease.ts';
import { boxAt, type BoxTarget } from './capture.ts';
import './tokens.css';
import './capture.css';

export interface ElementBoxProps {
  /** The elements the pointer finds, in order, each with the moment the box snaps to it. */
  targets: readonly BoxTarget[];
  /** The clock, in seconds. */
  time: number;
  /** The frozen display dims as the capture starts, 0 → 1. Default 1. */
  dim?: number | undefined;
  /** A committed selection: its eight handles show. */
  handles?: boolean | undefined;
  /** The "W × H" size label above the box. Default true. */
  label?: boolean | undefined;
}

/**
 * The capture's element snapping (`CaptureChromeView`): the frozen display dimmed to 40% except the
 * detected element under the pointer, which the accent outline and its size label mark, and which
 * springs from one element to the next. Fills its parent, which should be the display's box in
 * points; target boxes are in that box's coordinates.
 */
export function ElementBox({
  targets,
  time,
  dim = 1,
  handles = false,
  label = true,
}: ElementBoxProps) {
  const box = boxAt(targets, time);
  const area = {
    '--x': box.x,
    '--y': box.y,
    '--w': box.width,
    '--h': box.height,
    '--o': clamp01(dim),
  };
  const corners = [0, 0.5, 1].flatMap((u) =>
    [0, 0.5, 1].filter((v) => u !== 0.5 || v !== 0.5).map((v) => [u, v] as const),
  );
  return (
    <div className="pk-capture">
      <div className="pk-capture__hole" data-outline="" style={area} />
      {handles &&
        corners.map(([u, v]) => (
          <i
            key={`${u}-${v}`}
            className="pk-capture__handle"
            style={{ '--hx': box.x + box.width * u, '--hy': box.y + box.height * v }}
          />
        ))}
      {label && (
        <span className="pk-capture__size" style={area}>
          {Math.round(box.width)} × {Math.round(box.height)}
        </span>
      )}
    </div>
  );
}
