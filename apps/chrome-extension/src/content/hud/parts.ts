import { PART_BLUR, PART_DELAY, PART_EXIT, arrive, leave } from './island.ts';

/**
 * The parts a change in place keeps track of: the leaves the states and cards name (`data-part`:
 * glyph, title, detail, body, note, divider) and their buttons (`data-act`).
 */
const PARTS = '[data-part], [data-act]';

/** A part's box in its face's own layout (px), whatever scale the face is drawn at. */
interface Place {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Before {
  element: HTMLElement;
  place: Place;
  scroll: number;
  /** Inherited from where it stood, which a part fading out on its own no longer is. */
  lineHeight: string;
}

/** Where each part of a content stood in its face just before it changed. */
export type Snapshot = Map<string, Before>;

function partKey(element: HTMLElement): string {
  return element.dataset.part ?? `act:${element.dataset.act ?? ''}`;
}

function partsOf(node: ParentNode): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(PARTS)];
}

/** The parts of `node`, shown in `face`, where they stand in its layout. */
export function snapshot(face: HTMLElement, node: HTMLElement): Snapshot {
  const origin = face.getBoundingClientRect();
  // The face may be drawn scaled as it follows the shape; its layout width is its own.
  const scale = face.offsetWidth > 0 ? origin.width / face.offsetWidth : 1;
  const before: Snapshot = new Map();
  for (const element of partsOf(node)) {
    const key = partKey(element);
    if (before.has(key)) continue;
    const rect = element.getBoundingClientRect();
    before.set(key, {
      element,
      place: {
        left: (rect.left - origin.left) / scale,
        top: (rect.top - origin.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      },
      scroll: element.scrollTop,
      lineHeight: getComputedStyle(element).lineHeight,
    });
  }
  return before;
}

/**
 * The parts of `after`, which has just taken `before`'s place in `face`, change in place while the
 * face scales with its shape as one piece: a part that stays as it was stays; one that changed
 * crosses over, the old one fading out where it stood as the new one arrives out of a light blur;
 * one that went fades out where it stood, and a new one arrives. A reply scrolled down stays where
 * it was read. Under Reduce Motion the parts only cross-fade.
 */
export function changeInPlace(
  face: HTMLElement,
  before: Snapshot,
  after: HTMLElement,
  reduce: boolean,
): void {
  for (const element of partsOf(after)) {
    const key = partKey(element);
    const old = before.get(key);
    if (!old) {
      arrive(element, PART_BLUR, PART_DELAY, reduce);
      continue;
    }
    before.delete(key);
    if (old.scroll > 0) element.scrollTop = old.scroll;
    if (old.element.isEqualNode(element)) continue;
    fadeOut(face, old, reduce);
    arrive(element, PART_BLUR, PART_DELAY, reduce);
  }
  for (const old of before.values()) fadeOut(face, old, reduce);
}

/** The part that went, or the old side of one that changed, fades out where it stood. */
function fadeOut(face: HTMLElement, old: Before, reduce: boolean): void {
  const ghost = old.element;
  // Out of the content's parts and its focus order: it only shows on its way out.
  delete ghost.dataset.part;
  delete ghost.dataset.act;
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.add('hud-ghost');
  const style = ghost.style;
  const { left, top, width, height } = old.place;
  style.setProperty('left', `${left}px`);
  style.setProperty('top', `${top}px`);
  style.setProperty('width', `${width}px`);
  style.setProperty('height', `${height}px`);
  style.setProperty('line-height', old.lineHeight);
  face.append(ghost);
  const fading = leave(ghost, PART_BLUR, PART_EXIT, reduce);
  fading.onfinish = () => ghost.remove();
  fading.oncancel = fading.onfinish;
}
