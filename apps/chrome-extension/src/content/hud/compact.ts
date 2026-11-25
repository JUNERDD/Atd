/**
 * A capsule row stays one line. When its actions would leave its status too little room, each
 * secondary action that has an icon shows only the icon, its label becoming its name and tooltip;
 * the primary action (solid) and actions without an icon keep their label. The row decides from its
 * own layout at full labels, in the language it shows, and decides again whenever its room changes,
 * so a wider window gives the labels back.
 */

/** The status text a row keeps (px) before its actions give up their labels. */
const STATUS_ROOM = 120;

/** Lays `row` out for the room it has now. */
export function fitRow(row: HTMLElement): void {
  const buttons = [...row.querySelectorAll<HTMLButtonElement>(':scope > .gbtn:not(.solid)')].filter(
    (button) => button.querySelector(':scope > .i') && button.querySelector(':scope > .gbtn-label'),
  );
  if (buttons.length === 0) return;
  for (const button of buttons) button.classList.remove('compact');
  const compact = crowded(row);
  for (const button of buttons) {
    button.classList.toggle('compact', compact);
    const label = button.querySelector(':scope > .gbtn-label')?.textContent ?? '';
    if (compact) {
      button.setAttribute('aria-label', label);
      button.title = label;
    } else {
      button.removeAttribute('aria-label');
      button.removeAttribute('title');
    }
  }
}

/**
 * Whether the row's actions crowd its status: they run past the row, or its text is cut shorter
 * than both its own width and `STATUS_ROOM`. Layout widths, so a face drawn scaled reads the same.
 */
function crowded(row: HTMLElement): boolean {
  if (row.scrollWidth > row.clientWidth) return true;
  const text = row.querySelector<HTMLElement>('.hud-text');
  if (!text) return false;
  const needed = Math.max(0, ...[...text.children].map((line) => line.scrollWidth));
  return text.clientWidth + 1 < Math.min(needed, STATUS_ROOM);
}
