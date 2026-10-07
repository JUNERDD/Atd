/** Pointer input, written by listeners and read by the frame loop. */
export interface PointerState {
  /** Latest position in viewport coordinates. */
  clientX: number;
  clientY: number;
  /** The lens should show: a hovering mouse, or a touch or pen that is pressed. */
  engaged: boolean;
  /** Canvas top-left in document coordinates, refreshed whenever a gesture starts. */
  originX: number;
  originY: number;
}

export interface PointerHandlers {
  /** Input changed; the loop needs a frame. */
  onChange(): void;
  /** A click or a completed tap at viewport coordinates. */
  onTap(clientX: number, clientY: number): void;
}

export function createPointerState(): PointerState {
  return { clientX: 0, clientY: 0, engaged: false, originX: 0, originY: 0 };
}

/**
 * Mouse: the lens follows hover and a press starts a ripple. Touch and pen: the lens follows the
 * contact while it is down and a completed tap starts a ripple; a contact the browser takes over
 * for scrolling (pointercancel) only releases the lens. All listeners are passive.
 */
export function bindPointer(
  target: HTMLElement,
  canvas: HTMLCanvasElement,
  state: PointerState,
  handlers: PointerHandlers,
): () => void {
  let contact: number | null = null;

  // One layout read per gesture start; the loop adds the live scroll offset to stay in sync.
  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    state.originX = rect.left + window.scrollX;
    state.originY = rect.top + window.scrollY;
  };
  const track = (event: PointerEvent) => {
    state.clientX = event.clientX;
    state.clientY = event.clientY;
    state.engaged = true;
    handlers.onChange();
  };
  const release = () => {
    state.engaged = false;
    handlers.onChange();
  };

  const onEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    measure();
    track(event);
  };
  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' || event.pointerId === contact) track(event);
  };
  const onLeave = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') release();
  };
  const onDown = (event: PointerEvent) => {
    measure();
    if (event.pointerType === 'mouse') {
      track(event);
      if (event.button === 0) handlers.onTap(event.clientX, event.clientY);
      return;
    }
    contact = event.pointerId;
    track(event);
  };
  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== contact) return;
    contact = null;
    handlers.onTap(event.clientX, event.clientY);
    release();
  };
  const onCancel = (event: PointerEvent) => {
    if (event.pointerId !== contact) return;
    contact = null;
    release();
  };

  const abort = new AbortController();
  const options = { passive: true, signal: abort.signal };
  target.addEventListener('pointerenter', onEnter, options);
  target.addEventListener('pointermove', onMove, options);
  target.addEventListener('pointerleave', onLeave, options);
  target.addEventListener('pointerdown', onDown, options);
  target.addEventListener('pointerup', onUp, options);
  target.addEventListener('pointercancel', onCancel, options);
  return () => abort.abort();
}
