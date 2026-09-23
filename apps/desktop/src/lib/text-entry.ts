/** Input types that take no typed text; focus on them never holds a draft. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Whether the user is typing: focus is in a textarea, a text input, or editable content such as
 * the composer editor. Read from attributes because jsdom has no `isContentEditable`. HITL
 * controls must not take focus then, or the next Enter meant for the draft would approve.
 */
export function isTextEntryFocused(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement) return true;
  if (active instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(active.type);
  return active instanceof HTMLElement && active.closest('[contenteditable="true"]') !== null;
}
