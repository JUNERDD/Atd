/**
 * Dev-only click-to-component inspector.
 * - Hold Option (⌥) to highlight React components.
 * - Left click opens the component in the configured editor.
 * - Right click opens the Component Hierarchy panel with an editor switcher.
 */

import { resolveOpenTarget } from './component-chain';
import { openInEditor } from './editor';
import {
  closeHierarchyPanel,
  isEventInsideHierarchyPanel,
  isHierarchyOpen,
  openHierarchyPanel,
  setHierarchyClosedListener,
} from './hierarchy';
import { ensureOverlay, resetBadgeFeedback, showOpeningFeedback, updateHighlight } from './overlay';

declare global {
  interface Window {
    __COMPONENT_INSPECTOR_INITIALIZED__?: boolean;
  }
}

const INSPECTABLE_SELECTOR = '[data-insp-file]';

let active = false;

function resolveInspectableTarget(eventTarget: EventTarget | null): Element | null {
  return eventTarget instanceof Element ? eventTarget.closest(INSPECTABLE_SELECTOR) : null;
}

function deactivate(): void {
  active = false;
  if (!isHierarchyOpen()) {
    updateHighlight(null);
    document.body.style.cursor = '';
  }
}

function activate(): void {
  if (active) return;
  active = true;
  ensureOverlay();
  document.body.style.cursor = 'crosshair';
}

function openTargetInEditor(target: Element): void {
  const node = resolveOpenTarget(target);
  if (!node) return;

  showOpeningFeedback();
  openInEditor(node.file, node.line, node.col);
  window.setTimeout(() => {
    resetBadgeFeedback();
    deactivate();
  }, 400);
}

export function initComponentInspector(): void {
  if (typeof window === 'undefined') return;
  if (window.__COMPONENT_INSPECTOR_INITIALIZED__) return;
  window.__COMPONENT_INSPECTOR_INITIALIZED__ = true;

  ensureOverlay();
  setHierarchyClosedListener(deactivate);

  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Alt' || event.altKey) {
        activate();
      }
      if (event.key === 'Escape') {
        if (isHierarchyOpen()) {
          closeHierarchyPanel();
        } else {
          deactivate();
        }
      }
    },
    true,
  );

  window.addEventListener(
    'keyup',
    (event) => {
      if (!event.altKey && active) {
        deactivate();
      }
    },
    true,
  );

  window.addEventListener('blur', () => {
    deactivate();
  });

  window.addEventListener(
    'mousemove',
    (event) => {
      if (!active || isHierarchyOpen()) return;
      const target = resolveInspectableTarget(event.target);
      updateHighlight(target && resolveOpenTarget(target), event.clientX, event.clientY);
    },
    true,
  );

  window.addEventListener(
    'click',
    (event) => {
      if (isHierarchyOpen()) {
        if (!isEventInsideHierarchyPanel(event.target)) {
          closeHierarchyPanel();
        }
        return;
      }

      if (!active && !event.altKey) return;

      const target = resolveInspectableTarget(event.target);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openTargetInEditor(target);
    },
    true,
  );

  window.addEventListener(
    'contextmenu',
    (event) => {
      if (!active && !event.altKey) return;

      const target = resolveInspectableTarget(event.target);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openHierarchyPanel(target, event.clientX, event.clientY);
    },
    true,
  );
}

initComponentInspector();
