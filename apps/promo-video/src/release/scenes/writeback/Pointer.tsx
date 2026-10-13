import { Cursor } from '../../../kit/world/Cursor.tsx';
import type { CursorState } from '../../../kit/world/cursor.ts';
import { Keycaps } from '../../../kit/world/Keycaps.tsx';
import { ramp } from '../../../motion/ease.ts';

interface PointerProps {
  state: CursorState;
  t: number;
  /** The I-beam over text (the kit's pointer draws only the arrow and the hand). */
  beam: boolean;
  opacity: number;
  /** The ⌥ hint: when it appears, goes down, comes up, and has faded. */
  option: { show: number; down: number; up: number; gone: number };
}

/**
 * The text cursor macOS shows over editable text: a thin I-beam with serifed ends, black with a
 * white outline, its hotspot at its middle. Scene-local, as the kit's `Cursor` has no I-beam.
 */
function IBeam({ state, opacity }: { state: CursorState; opacity: number }) {
  return (
    <div
      className="r08-wb-beam"
      style={{ '--x': state.x, '--y': state.y, '--o': opacity, '--s': state.scale }}
    >
      <svg className="r08-wb-beam__svg" viewBox="-5 -10 10 20" aria-hidden="true">
        <path
          className="r08-wb-beam__shape"
          d="M-3.2 -8.6C-1.6 -8.6 -0.6 -8 0 -7.2C0.6 -8 1.6 -8.6 3.2 -8.6M0 -7.2V7.2M-3.2 8.6C-1.6 8.6 -0.6 8 0 7.2C0.6 8 1.6 8.6 3.2 8.6M-1.6 0H1.6"
        />
      </svg>
    </div>
  );
}

/**
 * The person's hand on the Mac: the pointer (an I-beam over the text, the arrow elsewhere) and,
 * while the selection toolbar's trigger is held, a small ⌥ keycap riding beside it, pressed for
 * as long as Option is down.
 */
export function Pointer({ state, t, beam, opacity, option }: PointerProps) {
  const hint = ramp(t, option.show, 0.2) * (1 - ramp(t, option.up + 0.1, option.gone - option.up));
  return (
    <>
      {hint > 0.01 ? (
        <div
          className="r08-wb-option"
          style={{ '--x': state.x, '--y': state.y, '--o': hint, '--rise': (1 - hint) * 6 }}
        >
          <Keycaps
            t={t}
            variant="hint"
            size={17}
            keys={[{ legend: '⌥', press: option.down, release: option.up }]}
          />
        </div>
      ) : null}
      {beam ? (
        <IBeam state={state} opacity={opacity} />
      ) : (
        <Cursor state={state} opacity={opacity} />
      )}
    </>
  );
}
