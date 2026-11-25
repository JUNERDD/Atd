import { startContent } from './app.ts';

/**
 * Content script entry. Chrome runs it at `document_idle` in every top frame, and the service
 * worker injects the same file into tabs that were open before the extension loaded; both can land
 * in the same isolated world, so a marker on its global object keeps one instance. Frames, non-HTML
 * documents and an extension context that is already gone get nothing.
 */
const INSTANCE = Symbol.for('atd.chrome.content');
const scope = globalThis as typeof globalThis & { [INSTANCE]?: true };

if (
  !scope[INSTANCE] &&
  window.top === window &&
  document.documentElement instanceof HTMLHtmlElement &&
  chrome.runtime?.id
) {
  scope[INSTANCE] = true;
  startContent();
}
