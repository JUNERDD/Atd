/** Native scrolling inputs that must take over before the browser emits a scroll event. */
export type ScrollIntent = 'up' | 'down' | 'drag' | 'release';

/** Whether a nested scrolling surface can consume the input before it reaches this viewport. */
function consumedWithin(viewport: HTMLElement, target: EventTarget | null, up: boolean): boolean {
  if (!(target instanceof Element)) return false;
  for (
    let element: Element | null = target;
    element && element !== viewport;
    element = element.parentElement
  ) {
    if (!(element instanceof HTMLElement) || element.scrollHeight <= element.clientHeight) continue;
    if (!['auto', 'scroll'].includes(getComputedStyle(element).overflowY)) continue;
    if (
      up ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight
    )
      return true;
  }
  return false;
}

/**
 * Hears native inputs on the ScrollArea root, including its sibling scrollbar. Direction is input
 * intent only: the transcript still reads actual offsets to decide whether it moved and whether
 * the bottom is visible. Nested scrollers and editing keys keep their own input.
 */
export function listenForScrollIntent(
  viewport: HTMLElement,
  onIntent: (intent: ScrollIntent) => void,
): () => void {
  const root = viewport.parentElement;
  if (!root) return () => {};
  let dragging: number | null = null;
  const wheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.shiftKey || event.deltaY === 0) return;
    const up = event.deltaY < 0;
    if (!consumedWithin(viewport, event.target, up)) onIntent(up ? 'up' : 'down');
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    if (
      event.key === ' ' &&
      event.target instanceof Element &&
      event.target.closest('button, a[href], [role="button"]')
    )
      return;
    const up =
      ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    const down =
      ['ArrowDown', 'PageDown', 'End'].includes(event.key) ||
      (event.key === ' ' && !event.shiftKey);
    if ((up || down) && !consumedWithin(viewport, event.target, up)) onIntent(up ? 'up' : 'down');
  };
  const pointerdown = (event: PointerEvent) => {
    const bar =
      event.target instanceof Element
        ? event.target.closest('[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]')
        : null;
    if (event.button !== 0 || bar?.parentElement !== root) return;
    dragging = event.pointerId;
    onIntent('drag');
  };
  const pointerup = (event: PointerEvent) => {
    if (event.pointerId !== dragging) return;
    dragging = null;
    onIntent('release');
  };
  root.addEventListener('wheel', wheel, { passive: true });
  root.addEventListener('keydown', keydown);
  root.addEventListener('pointerdown', pointerdown, true);
  window.addEventListener('pointerup', pointerup);
  window.addEventListener('pointercancel', pointerup);
  return () => {
    root.removeEventListener('wheel', wheel);
    root.removeEventListener('keydown', keydown);
    root.removeEventListener('pointerdown', pointerdown, true);
    window.removeEventListener('pointerup', pointerup);
    window.removeEventListener('pointercancel', pointerup);
  };
}
