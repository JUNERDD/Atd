/** Environment changes that decide whether and at what size a field draws. */
export interface FieldSignals {
  /** The canvas's CSS box changed. */
  onResize(width: number, height: number): void;
  /** Drawing is useful: the canvas is near the viewport and the document is visible. */
  onActive(active: boolean): void;
  onContextLost(): void;
  onContextRestored(): void;
}

/**
 * Observes the canvas size, its intersection with the viewport (with a small margin so the field is
 * already drawing when it scrolls in), document visibility, and WebGL context loss. Returns the
 * function that disconnects everything.
 */
export function observeField(canvas: HTMLCanvasElement, signals: FieldSignals): () => void {
  let intersecting = false;
  let active = false;
  const update = () => {
    const next = intersecting && !document.hidden;
    if (next === active) return;
    active = next;
    signals.onActive(next);
  };

  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry) signals.onResize(entry.contentRect.width, entry.contentRect.height);
  });
  resizeObserver.observe(canvas);

  const intersection = new IntersectionObserver(
    (entries) => {
      intersecting = entries[entries.length - 1]?.isIntersecting ?? false;
      update();
    },
    { rootMargin: '64px 0px' },
  );
  intersection.observe(canvas);

  const abort = new AbortController();
  document.addEventListener('visibilitychange', update, { signal: abort.signal });
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault(); // Lets the browser restore the context later.
      signals.onContextLost();
    },
    { signal: abort.signal },
  );
  canvas.addEventListener('webglcontextrestored', () => signals.onContextRestored(), {
    signal: abort.signal,
  });

  return () => {
    resizeObserver.disconnect();
    intersection.disconnect();
    abort.abort();
  };
}
