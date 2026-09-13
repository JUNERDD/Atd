import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  delete window.desktop;
});

afterEach(cleanup);

// jsdom has no layout engine; geometry and ScrollArea behavior are checked in Electron.
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
