/** The attribute a settings page puts on an element the search can open onto. */
const ANCHOR = 'data-settings-anchor';
/** Set on the revealed element for `HIGHLIGHT_MS`; `settings.css` draws it. */
const HIGHLIGHT = 'data-settings-highlight';
const HIGHLIGHT_MS = 1600;
/** About 0.75s of frames for the section to render and the drawer to leave. */
const MAX_FRAMES = 45;
const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="switch"]:not([disabled])';

let highlighted: { element: Element; timer: number } | null = null;

const visible = (element: Element) => element.getClientRects().length > 0;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Whether a drawer is still on screen. Its focus trap hands focus back to the menu button when it
 * unmounts, which would undo a focus moved earlier.
 */
const drawerOpen = () => document.querySelector('[data-slot="sheet-content"]') !== null;

function highlight(element: Element) {
  if (highlighted) {
    window.clearTimeout(highlighted.timer);
    highlighted.element.removeAttribute(HIGHLIGHT);
  }
  // Removing the attribute first restarts the animation when the same element is revealed twice.
  element.removeAttribute(HIGHLIGHT);
  void (element as HTMLElement).offsetWidth;
  element.setAttribute(HIGHLIGHT, '');
  const timer = window.setTimeout(() => {
    element.removeAttribute(HIGHLIGHT);
    if (highlighted?.element === element) highlighted = null;
  }, HIGHLIGHT_MS);
  highlighted = { element, timer };
}

function reveal(element: Element) {
  element.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  highlight(element);
  const control = element.matches(FOCUSABLE) ? element : element.querySelector(FOCUSABLE);
  // The scroll above is smooth, so focusing must not jump the viewport to the control first.
  if (control instanceof HTMLElement) control.focus({ preventScroll: true });
}

function scrollPageToTop() {
  document
    .querySelector('.settings-page:not([hidden])')
    ?.closest('[data-slot="scroll-area-viewport"]')
    ?.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Brings a setting into view after the search opened its section: scrolls the element marked
 * `data-settings-anchor="<anchor>"` to the middle of the content, highlights it briefly and moves
 * focus to its control. Without an anchor, or when the page does not render it (a section still
 * loading, a group its state hides), the section page scrolls to its top instead.
 *
 * It runs from a module rather than the search panel because the drawer unmounts the panel on
 * navigation. It waits a few animation frames for the section to render and become visible.
 */
export function revealSettingsAnchor(anchor: string | undefined) {
  let frames = 0;
  const step = () => {
    if (drawerOpen() && ++frames < MAX_FRAMES) {
      requestAnimationFrame(step);
      return;
    }
    const target = anchor
      ? [...document.querySelectorAll(`[${ANCHOR}="${anchor}"]`)].find(visible)
      : undefined;
    if (target) reveal(target);
    else if (anchor && ++frames < MAX_FRAMES) requestAnimationFrame(step);
    else scrollPageToTop();
  };
  // Two frames: the state update that shows the section, then its layout.
  requestAnimationFrame(() => requestAnimationFrame(step));
}
