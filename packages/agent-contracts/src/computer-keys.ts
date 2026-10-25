import { Type, type Static } from 'typebox';

/**
 * The closed key vocabulary of the `key` step. A plain navigation or typing key only edits or
 * moves within the focused control (`input`); anything else, a modifier chord, `return`, `escape`
 * or a function key, may run a command whose business effect nobody knows, so it is `invoke`.
 */

/** Keys that move focus or the caret. */
export const COMPUTER_NAV_KEYS = [
  'tab',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
] as const;

const LETTER_KEYS = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
] as const;
const DIGIT_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const FUNCTION_KEYS = [
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
] as const;

/** Letters and digits, the only keys `shift` alone may accompany and still be `input`. */
export const COMPUTER_CHARACTER_KEYS = [...LETTER_KEYS, ...DIGIT_KEYS] as const;

/** Keys that type or erase text in the focused control. */
export const COMPUTER_TYPING_KEYS = [...COMPUTER_CHARACTER_KEYS, 'space', 'delete'] as const;

/** Keys that are always `invoke`: they confirm, dismiss or trigger a command. */
const COMMAND_KEYS = ['return', 'escape', ...FUNCTION_KEYS] as const;

export const COMPUTER_KEY_NAMES = [
  ...COMMAND_KEYS,
  ...COMPUTER_NAV_KEYS,
  ...COMPUTER_TYPING_KEYS,
] as const;

/** A key a `key` step presses (closed; no raw key codes). */
export const ComputerKeyNameSchema = Type.Enum(COMPUTER_KEY_NAMES);
export type ComputerKeyName = Static<typeof ComputerKeyNameSchema>;

export const COMPUTER_MODIFIERS = ['cmd', 'shift', 'option', 'ctrl'] as const;

/** A modifier held while a `key` step presses its key. */
export const ComputerModifierSchema = Type.Enum(COMPUTER_MODIFIERS);
export type ComputerModifier = Static<typeof ComputerModifierSchema>;

const PLAIN_INPUT_KEYS: ReadonlySet<ComputerKeyName> = new Set([
  ...COMPUTER_NAV_KEYS,
  ...COMPUTER_TYPING_KEYS,
]);
const CHARACTER_KEYS: ReadonlySet<ComputerKeyName> = new Set(COMPUTER_CHARACTER_KEYS);

/**
 * Whether a key press is plain input: a navigation or typing key with no modifier, or a letter or
 * digit with `shift` alone. Every other press is `invoke`.
 */
export function isPlainKeyInput(
  key: ComputerKeyName,
  modifiers: readonly ComputerModifier[] = [],
): boolean {
  if (modifiers.length === 0) return PLAIN_INPUT_KEYS.has(key);
  return modifiers.length === 1 && modifiers[0] === 'shift' && CHARACTER_KEYS.has(key);
}
