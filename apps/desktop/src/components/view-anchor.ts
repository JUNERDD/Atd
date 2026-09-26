import type { PillView } from '../features/agent/progress/progress-pill';

/** Matches the morph viewport's resize, so the slide and the resize land together. */
const SLIDE_MS = 200;

/** `cubic-bezier(0.22, 1, 0.36, 1)` is an ease-out quint; its closed form avoids a solver. */
function easeOut(progress: number): number {
  return 1 - (1 - progress) ** 5;
}

/**
 * Where the popover anchors for a view: horizontally the part that opens it, so each view centers
 * on its part; the HITL view spans the whole anchor instead (the composer's width, which its
 * panel reads as the trigger width). Vertically the top of the pill, so every view stacks above
 * it.
 */
function viewRect(root: HTMLElement, view: PillView | null): DOMRect {
  const part = view === 'hitl' ? null : root.querySelector(`[data-pill-view="${view}"]`);
  const { left, width } = (part ?? root).getBoundingClientRect();
  const top = (root.querySelector('.composer-progress') ?? root).getBoundingClientRect().top;
  return new DOMRect(left, top, width, 0);
}

/**
 * The popover's virtual anchor across view switches. A switch tweens only the horizontal span
 * from where the anchor last was to the next part; Radix re-reads the anchor every frame
 * (`updatePositionStrategy="always"`), so the popover slides sideways while its vertical position
 * is recomputed from its current height each frame and its bottom stays on the pill. Animating
 * the positioned wrapper's transform instead would lag that vertical position too, dropping the
 * popover below the pill while a taller view grows.
 */
export function createViewAnchor() {
  let view: PillView | null = null;
  let last: DOMRect | null = null;
  let slide: { from: DOMRect; start: number } | null = null;
  return (root: HTMLElement | null, next: PillView | null, animate: boolean): DOMRect => {
    // A hidden composer (a subagent's drill-in covers the task) leaves the pill without a box;
    // the closing popover fades out where it was instead of jumping to the viewport origin.
    if (!root || root.getClientRects().length === 0) return last ?? new DOMRect();
    if (next !== view) {
      slide = animate && last ? { from: last, start: performance.now() } : null;
      view = next;
    }
    const target = viewRect(root, next);
    const progress = slide ? (performance.now() - slide.start) / SLIDE_MS : 1;
    if (!slide || progress >= 1) {
      slide = null;
      last = target;
      return target;
    }
    const eased = easeOut(progress);
    const left = slide.from.left + (target.left - slide.from.left) * eased;
    const width = slide.from.width + (target.width - slide.from.width) * eased;
    last = new DOMRect(left, target.top, width, 0);
    return last;
  };
}
