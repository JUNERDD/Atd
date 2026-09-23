import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import '../src/i18n';

beforeEach(() => {
  localStorage.clear();
  delete window.desktop;
});

afterEach(cleanup);

// jsdom has no layout engine; geometry and ScrollArea behavior are checked in Electron.
// CodeMirror (the composer editor) measures text through Range geometry; the quick panel and
// cmdk scroll the active option into view.
Range.prototype.getBoundingClientRect = () => new DOMRect();
Range.prototype.getClientRects = () => document.createElement('span').getClientRects();
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

window.matchMedia = (media) => ({
  media,
  matches: window.innerWidth >= Number(media.match(/min-width: (\d+)px/)?.[1] ?? 0),
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
});
