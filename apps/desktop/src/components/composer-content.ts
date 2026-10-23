/** A box in the coordinates of the element a capture was taken against. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A still copy of the composer's draft as it was sent, and where and how it showed. */
export interface ComposerContent {
  node: HTMLElement;
  /** The surface was expanded for a draft of several rows. */
  expanded: boolean;
  /** The input's visible box, and where it was scrolled. */
  box: Box;
  scrollTop: number;
  scrollLeft: number;
  /** The first visible line, which a sent message lines up with its bubble's first line. */
  line: Box;
  /** The surface's height and corner radius, which it eases from as it takes the pill's shape. */
  surface: { height: number; radius: number };
}

function relative(rect: DOMRect, origin: DOMRect): Box {
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  };
}

/** The corner radius an element draws: a pill's 999px resolves to half its height. */
export function drawnRadius(element: Element, height: number): number {
  return Math.min(parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0, height / 2);
}

/**
 * Copies the draft the composer under `root` (the panel body) shows, with the geometry a sent
 * message leaves from, before the send changes the composer. The copy is inert DOM: the caret and
 * selection layers stay behind, and nothing in it is wired to the editor.
 */
export function captureComposerContent(root: HTMLElement | null): ComposerContent | null {
  const surface = root?.querySelector('.composer-surface');
  const input = surface?.querySelector('.composer-input');
  const viewport = surface?.querySelector(
    '.composer-input-scroll [data-slot="scroll-area-viewport"]',
  );
  if (!root || !surface || !input || !viewport) return null;
  const copy = input.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return null;
  for (const layer of copy.querySelectorAll('.cm-cursorLayer, .cm-selectionLayer')) layer.remove();
  const origin = root.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  const lines = [...input.querySelectorAll('.cm-line')].map((line) => line.getBoundingClientRect());
  const line = lines.find((rect) => rect.bottom > view.top) ?? view;
  const height = surface.getBoundingClientRect().height;
  return {
    node: copy,
    expanded: surface.getAttribute('data-expanded') === 'true',
    box: relative(view, origin),
    scrollTop: viewport.scrollTop,
    scrollLeft: input.querySelector('.cm-scroller')?.scrollLeft ?? 0,
    line: relative(line, origin),
    surface: { height, radius: drawnRadius(surface, height) },
  };
}
