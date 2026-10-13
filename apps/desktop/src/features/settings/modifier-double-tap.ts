import type { DoubleTapModifier } from '@atd/agent-contracts';

/**
 * The longest time from the first tap's press to the second press for two taps of a modifier to
 * count as a double-tap, and the longest the second press may stay down. The shell's detector
 * (`ModifierDoubleTap.interval` and `secondTapLimit` in AICore) uses the same values, so what
 * records is what fires.
 */
export const DOUBLE_TAP_INTERVAL_MS = 400;
export const SECOND_TAP_LIMIT_MS = 350;

/** `KeyboardEvent.key` of each modifier a double-tap can use. */
const MODIFIER_KEYS: Record<string, DoubleTapModifier> = {
  Meta: 'Command',
  Alt: 'Alt',
  Control: 'Control',
  Shift: 'Shift',
};

type TapEvent = Pick<
  KeyboardEvent,
  'type' | 'key' | 'repeat' | 'metaKey' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'timeStamp'
>;

type State =
  | { phase: 'idle' }
  /** `down`: the first press since `at`; `tapped`: it came up in time; `second`: pressed again. */
  | { phase: 'down' | 'tapped' | 'second'; modifier: DoubleTapModifier; at: number };

/**
 * Follows key events for a double-tap of one lone modifier, with the shell's rules: a tap is the
 * modifier going down and up with no other modifier or key in between, the second press must
 * start within `DOUBLE_TAP_INTERVAL_MS` of the first and come up within `SECOND_TAP_LIMIT_MS`.
 * Answers the modifier as that second tap comes up, so a tap followed by a shortcut with the same
 * modifier (⌘, then ⌘C) never records; any other key or modifier starts over.
 */
export function modifierDoubleTap(): (event: TapEvent) => DoubleTapModifier | null {
  let state: State = { phase: 'idle' };
  return (event) => {
    if (event.repeat) return null;
    // Only modifier changes move a tap along, as the shell sees only those; any other key going
    // down starts over.
    if (!(event.key in MODIFIER_KEYS)) {
      if (event.type === 'keydown') state = { phase: 'idle' };
      return null;
    }
    const held = (
      [
        [event.metaKey, 'Command'],
        [event.altKey, 'Alt'],
        [event.ctrlKey, 'Control'],
        [event.shiftKey, 'Shift'],
      ] as const
    ).flatMap(([down, modifier]) => (down ? [modifier] : []));
    const now = event.timeStamp;
    const [modifier, ...others] = held;
    if (others.length > 0) {
      state = { phase: 'idle' };
    } else if (modifier) {
      if (
        state.phase === 'tapped' &&
        state.modifier === modifier &&
        now - state.at <= DOUBLE_TAP_INTERVAL_MS
      )
        state = { phase: 'second', modifier, at: now };
      else if (state.phase === 'idle' || state.phase === 'tapped' || state.modifier !== modifier)
        state = { phase: 'down', modifier, at: now };
    } else if (state.phase === 'down') {
      state =
        now - state.at <= DOUBLE_TAP_INTERVAL_MS
          ? { phase: 'tapped', modifier: state.modifier, at: state.at }
          : { phase: 'idle' };
    } else if (state.phase === 'second') {
      const tapped = now - state.at <= SECOND_TAP_LIMIT_MS ? state.modifier : null;
      state = { phase: 'idle' };
      return tapped;
    }
    return null;
  };
}
