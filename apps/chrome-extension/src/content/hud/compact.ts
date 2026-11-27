/**
 * A capsule row and a card's footer each stay one line. When their actions would not fit (a row's
 * would also leave its status too little room), secondary actions that have an icon show only the
 * icon, their label becoming their name and tooltip; the primary action (solid) and actions
 * without an icon keep their label, as the island's footer compacts its actions
 * (`IslandFooterRow`). Each decides from its own layout at full labels, in the language it shows,
 * and decides again whenever its room changes, so a wider window gives the labels back.
 */

/** The status text a row keeps (px) before its actions give up their labels. */
const STATUS_ROOM = 120;

/** Lays `row` out for the room it has now: its secondary actions compact together. */
export function fitRow(row: HTMLElement): void {
  const buttons = compactable(row);
  for (const button of buttons) setCompact(button, false);
  if (!crowded(row)) return;
  for (const button of buttons) setCompact(button, true);
}

/**
 * Lays the footer of `card` out for the room it has now. Its actions compact one at a time from
 * the leading end (Stop, then the card's own secondary actions), so a footer a little short of
 * room keeps the labels nearest its primary action, a feedback label (Save's "Sent to Atd")
 * among them. Where even that is too wide (a viewport narrower than the card's smallest), the
 * footer is `tight`: the labels left shorten with an ellipsis, each still whole in its tooltip.
 */
export function fitCard(card: HTMLElement): void {
  const footer = card.querySelector<HTMLElement>(':scope > .hud-card-actions');
  if (!footer) return;
  const overflows = () => footer.scrollWidth > footer.clientWidth;
  const buttons = compactable(footer);
  footer.classList.remove('tight');
  for (const button of buttons) setCompact(button, false);
  for (const button of buttons) {
    if (!overflows()) break;
    setCompact(button, true);
  }
  const tight = overflows();
  footer.classList.toggle('tight', tight);
  for (const button of footer.querySelectorAll<HTMLButtonElement>(':scope > .gbtn:not(.compact)')) {
    const label = labelOf(button);
    if (tight && label) button.title = label;
    else button.removeAttribute('title');
  }
}

/** The secondary actions directly in `bar` that can show their icon alone. */
function compactable(bar: HTMLElement): HTMLButtonElement[] {
  return [...bar.querySelectorAll<HTMLButtonElement>(':scope > .gbtn:not(.solid)')].filter(
    (button) => button.querySelector(':scope > .i') && button.querySelector(':scope > .gbtn-label'),
  );
}

function labelOf(button: HTMLButtonElement): string {
  return button.querySelector(':scope > .gbtn-label')?.textContent ?? '';
}

function setCompact(button: HTMLButtonElement, compact: boolean): void {
  button.classList.toggle('compact', compact);
  if (compact) {
    const label = labelOf(button);
    button.setAttribute('aria-label', label);
    button.title = label;
  } else {
    button.removeAttribute('aria-label');
    button.removeAttribute('title');
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
