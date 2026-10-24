import { contentTop, revealTop } from '../transcript/scroll-anchor';
import type { PromptEntry } from '../transcript/prompt-nav';
import { clamp } from './dial-geometry';

/** Within this of the end the view shows the bottom, where the last message is the current one. */
const NEAR_BOTTOM_PX = 16;

export function turnElement(viewport: HTMLElement, turnId: string): HTMLElement | null {
  return viewport.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(turnId)}"]`);
}

function nearBottom(viewport: HTMLElement): boolean {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= NEAR_BOTTOM_PX;
}

/**
 * Where the view rests with message `position` at its top: between two messages, the same fraction
 * of the way between where showing each would put the view (`revealTop`, the offset `show` lands
 * on). The window mounts every turn from some point to the end, so a message is either mounted or
 * above all mounted ones; one that is not mounted yet comes back as `{ mount }` instead of an offset.
 */
export function scrollFor(
  viewport: HTMLElement,
  prompts: readonly PromptEntry[],
  position: number,
): number | { mount: string } {
  const at = clamp(position, 0, prompts.length - 1);
  const index = Math.floor(at);
  const entry = prompts[index];
  if (!entry) return viewport.scrollTop;
  const from = turnElement(viewport, entry.turnId);
  if (!from) return { mount: entry.turnId };
  const start = revealTop(viewport, from);
  const next = prompts[index + 1];
  const to = next && at > index ? turnElement(viewport, next.turnId) : null;
  return to ? start + (revealTop(viewport, to) - start) * (at - index) : start;
}

/**
 * The dial position the view's offset stands for: the reverse of `scrollFor` over the mounted
 * messages, found by halving (their offsets only grow). At the bottom it is the last message; above
 * the first mounted one, that one.
 */
export function positionFor(viewport: HTMLElement, prompts: readonly PromptEntry[]): number {
  const last = prompts.length - 1;
  if (last <= 0 || nearBottom(viewport)) return Math.max(last, 0);
  const mounted: { index: number; element: HTMLElement }[] = [];
  prompts.forEach((entry, index) => {
    const element = turnElement(viewport, entry.turnId);
    if (element) mounted.push({ index, element });
  });
  const y = viewport.scrollTop + 1;
  const top = (at: number) => {
    const item = mounted[at];
    return item ? revealTop(viewport, item.element) : Infinity;
  };
  // The last mounted message whose offset the view has reached.
  let low = 0;
  let high = mounted.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (top(middle) <= y) low = middle;
    else high = middle - 1;
  }
  const here = mounted[low];
  if (!here) return last;
  const after = mounted[low + 1];
  const start = top(low);
  if (!after || start > y) return here.index;
  const span = top(low + 1) - start;
  const fraction = span > 0 ? clamp((y - 1 - start) / span, 0, 1) : 0;
  return here.index + fraction * (after.index - here.index);
}

/** Each message's rendered turn height, or undefined for a turn the window has not mounted. */
export function turnHeights(viewport: HTMLElement, prompts: readonly PromptEntry[]) {
  return prompts.map((entry) => turnElement(viewport, entry.turnId)?.offsetHeight);
}

/**
 * Where the reader was, kept in the content rather than as an offset: turns mounted above it while
 * the dial is open would shift a bare offset. At the bottom the place is the bottom.
 */
export type ReadingPlace = { bottom: true } | { bottom: false; element: Element; offset: number };

export function readingPlace(viewport: HTMLElement): ReadingPlace {
  if (nearBottom(viewport)) return { bottom: true };
  const top = viewport.getBoundingClientRect().top;
  for (const element of viewport.querySelectorAll('[data-turn-id]'))
    if (element.getBoundingClientRect().bottom > top)
      return { bottom: false, element, offset: viewport.scrollTop - contentTop(viewport, element) };
  return { bottom: true };
}

/** Takes the view back to `place`, gliding unless motion is reduced. */
export function returnTo(viewport: HTMLElement, place: ReadingPlace, reduced: boolean) {
  const top =
    place.bottom || !place.element.isConnected
      ? viewport.scrollHeight - viewport.clientHeight
      : contentTop(viewport, place.element) + place.offset;
  viewport.scrollTo({ top, behavior: reduced ? 'instant' : 'smooth' });
}
