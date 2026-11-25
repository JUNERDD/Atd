/**
 * The content script's lifetime. Every listener it adds to the page's window, document or media
 * queries passes `signal`, so an orphaned instance (the extension was reloaded or removed) drops
 * all of them at once and leaves the page as it found it.
 */
const controller = new AbortController();

export const signal: AbortSignal = controller.signal;

export function endLifetime(): void {
  controller.abort();
}
