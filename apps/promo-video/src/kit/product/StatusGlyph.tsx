import { spinAt } from './text.ts';
import './tokens.css';
import './popover.css';

export type GlyphState = 'pending' | 'running' | 'completed';

/**
 * The state glyph of a todo or a subagent row, drawn as Lucide draws `Circle`, `LoaderCircle` and
 * `CircleCheck` (1.75 stroke), so the check can draw itself in: `draw` runs 0 → 1 as it lands, and
 * `time` turns the spinner a turn a second.
 */
export function StatusGlyph({
  state,
  draw = 1,
  time = 0,
  className = 'pk-glyph',
}: {
  state: GlyphState;
  draw?: number | undefined;
  time?: number | undefined;
  className?: string | undefined;
}) {
  if (state === 'running')
    return (
      <svg
        className={`${className} pk-spin`}
        viewBox="0 0 24 24"
        style={{ '--spin': spinAt(time) }}
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  return (
    <svg className={className} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      {state === 'completed' && (
        <path
          className="pk-glyph__check"
          d="m9 12 2 2 4-4"
          pathLength={1}
          style={{ '--draw': draw }}
        />
      )}
    </svg>
  );
}
