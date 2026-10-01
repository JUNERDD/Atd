/**
 * Dev-only click-to-component inspector: draggable Component Hierarchy panel.
 */

import {
  EDITOR_OPTIONS,
  getEditorLabel,
  getPreferredEditor,
  isSupportedEditor,
  setPreferredEditor,
} from './editor';
import { collectHierarchy } from './component-chain';
import { createHierarchyRows } from './hierarchy-rows';
import { hideBadge, highlightElement } from './overlay';

const PADDING = 16;
const PANEL_ID = 'ai-component-inspector-hierarchy-panel';
const EDITOR_SELECT_ID = 'ai-hierarchy-editor-select';
const CLOSE_BUTTON_ID = 'ai-hierarchy-close';
const FOOTER_HINT_ID = 'ai-hierarchy-footer-hint';

let hierarchyPanelEl: HTMLDivElement | null = null;
let hierarchyClosedListener: (() => void) | null = null;
let panelStylesInjected = false;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function setHierarchyClosedListener(listener: () => void): void {
  hierarchyClosedListener = listener;
}

export function isHierarchyOpen(): boolean {
  return hierarchyPanelEl !== null;
}

export function isEventInsideHierarchyPanel(eventTarget: EventTarget | null): boolean {
  return (
    hierarchyPanelEl !== null &&
    eventTarget instanceof Node &&
    hierarchyPanelEl.contains(eventTarget)
  );
}

function ensurePanelStyles(): void {
  if (panelStylesInjected) return;
  panelStylesInjected = true;

  const styleTag = document.createElement('style');
  styleTag.textContent = `
    @keyframes aiPanelFadeIn {
      from { opacity: 0; transform: scale(0.97) translateY(-4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    #${PANEL_ID} *::-webkit-scrollbar {
      width: 6px;
    }
    #${PANEL_ID} *::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 3px;
    }
  `;
  document.head.appendChild(styleTag);
}

function handleWindowResize(): void {
  if (!hierarchyPanelEl) return;
  const rect = hierarchyPanelEl.getBoundingClientRect();
  const left = clamp(
    hierarchyPanelEl.offsetLeft,
    PADDING,
    window.innerWidth - rect.width - PADDING,
  );
  const top = clamp(
    hierarchyPanelEl.offsetTop,
    PADDING,
    window.innerHeight - rect.height - PADDING,
  );
  hierarchyPanelEl.style.left = `${left}px`;
  hierarchyPanelEl.style.top = `${top}px`;
}

export function closeHierarchyPanel(): void {
  window.removeEventListener('resize', handleWindowResize);
  if (hierarchyPanelEl) {
    hierarchyPanelEl.remove();
    hierarchyPanelEl = null;
  }
  hierarchyClosedListener?.();
}

export function openHierarchyPanel(target: Element, x: number, y: number): void {
  closeHierarchyPanel();
  ensurePanelStyles();
  hideBadge();

  const hierarchy = collectHierarchy(target);
  if (hierarchy.length === 0) return;

  const panel = document.createElement('div');
  hierarchyPanelEl = panel;
  panel.id = PANEL_ID;
  panel.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    width: 480px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: rgba(18, 18, 22, 0.96);
    backdrop-filter: blur(24px) saturate(190%);
    -webkit-backdrop-filter: blur(24px) saturate(190%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(56, 189, 248, 0.25);
    color: #f4f4f5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    overflow: hidden;
    user-select: none;
    animation: aiPanelFadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  const currentEditor = getPreferredEditor();

  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    cursor: grab;
    flex-shrink: 0;
  `;
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px;">
      <span style="color: #38bdf8; font-size: 14px;">◈</span>
      <span>Component Hierarchy</span>
      <span style="color: #71717a; font-size: 11px; font-weight: normal;">(${hierarchy.length} levels)</span>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <select id="${EDITOR_SELECT_ID}" title="Open in editor" style="
        background: rgba(255, 255, 255, 0.08);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.3);
        border-radius: 6px;
        padding: 2px 6px;
        font-size: 11px;
        font-family: inherit;
        font-weight: 600;
        cursor: pointer;
        outline: none;
      ">
        ${EDITOR_OPTIONS.map(
          (opt) =>
            `<option value="${opt.id}" ${opt.id === currentEditor ? 'selected' : ''} style="background: #18181b; color: #f4f4f5;">${opt.label}</option>`,
        ).join('')}
      </select>
      <button id="${CLOSE_BUTTON_ID}" style="
        background: none;
        border: none;
        color: #a1a1aa;
        cursor: pointer;
        font-size: 14px;
        padding: 2px 6px;
        border-radius: 4px;
        line-height: 1;
        transition: color 0.15s;
      ">✕</button>
    </div>
  `;

  header.querySelector<HTMLButtonElement>(`#${CLOSE_BUTTON_ID}`)?.addEventListener('click', () => {
    closeHierarchyPanel();
  });

  const editorSelect = header.querySelector<HTMLSelectElement>(`#${EDITOR_SELECT_ID}`);
  editorSelect?.addEventListener('change', () => {
    const value = editorSelect.value;
    if (!isSupportedEditor(value)) return;
    setPreferredEditor(value);
    const footerHint = panel.querySelector(`#${FOOTER_HINT_ID}`);
    if (footerHint) {
      footerHint.textContent = `Click any node to open in ${getEditorLabel(value)}`;
    }
  });

  const list = createHierarchyRows(hierarchy, target, closeHierarchyPanel);

  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 8px 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.25);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #71717a;
    flex-shrink: 0;
  `;
  footer.innerHTML = `
    <span id="${FOOTER_HINT_ID}">Click any node to open in ${getEditorLabel(currentEditor)}</span>
    <span style="font-size: 10px; color: #52525b;">Esc to close</span>
  `;

  panel.appendChild(header);
  panel.appendChild(list);
  panel.appendChild(footer);

  // Measure the assembled panel before placing it next to the click point.
  panel.style.visibility = 'hidden';
  panel.style.left = '0px';
  panel.style.top = '0px';
  document.documentElement.appendChild(panel);

  const rect = panel.getBoundingClientRect();

  let left = x + 12;
  if (left + rect.width > window.innerWidth - PADDING) {
    left = x - rect.width - 12;
  }
  left = clamp(left, PADDING, window.innerWidth - rect.width - PADDING);

  let top = y + 12;
  if (top + rect.height > window.innerHeight - PADDING) {
    top = y - rect.height - 12;
  }
  top = clamp(top, PADDING, window.innerHeight - rect.height - PADDING);

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.visibility = 'visible';

  window.addEventListener('resize', handleWindowResize);

  header.addEventListener('mousedown', (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (
      event.target.id === CLOSE_BUTTON_ID ||
      event.target.id === EDITOR_SELECT_ID ||
      event.target.closest(`#${EDITOR_SELECT_ID}`)
    ) {
      return;
    }

    let isDragging = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const origLeft = panel.offsetLeft;
    const origTop = panel.offsetTop;
    header.style.cursor = 'grabbing';

    const onMouseMove = (moveEv: MouseEvent) => {
      if (!isDragging) return;
      const panelRect = panel.getBoundingClientRect();
      const newLeft = clamp(
        origLeft + (moveEv.clientX - startX),
        PADDING,
        window.innerWidth - panelRect.width - PADDING,
      );
      const newTop = clamp(
        origTop + (moveEv.clientY - startY),
        PADDING,
        window.innerHeight - panelRect.height - PADDING,
      );
      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop}px`;
    };

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = 'grab';
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  highlightElement(target);
}
