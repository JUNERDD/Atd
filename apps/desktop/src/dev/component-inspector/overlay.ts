/**
 * Dev-only click-to-component inspector: hover overlay and cursor-following badge.
 */

import type { ComponentNode } from './component-chain';
import { getEditorLabel, getPreferredEditor } from './editor';

let overlayEl: HTMLDivElement | null = null;
let badgeEl: HTMLDivElement | null = null;

export function normalizePath(fullPath: string): string {
  const marker = '/src/';
  const markerIndex = fullPath.lastIndexOf(marker);
  return markerIndex === -1 ? fullPath : fullPath.slice(markerIndex + 1);
}

export function ensureOverlay(): void {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'ai-component-inspector-overlay';
  overlayEl.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483640;
    border: 2px solid #38bdf8;
    background: rgba(56, 189, 248, 0.08);
    border-radius: 4px;
    box-shadow: 0 0 16px rgba(56, 189, 248, 0.35);
    transition: all 0.06s cubic-bezier(0.16, 1, 0.3, 1);
    display: none;
  `;

  badgeEl = document.createElement('div');
  badgeEl.id = 'ai-component-inspector-badge';
  badgeEl.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 2147483641;
    background: rgba(18, 18, 22, 0.94);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 8px;
    padding: 6px 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.06);
    color: #f4f4f5;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    display: none;
    max-width: 480px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;

  document.documentElement.appendChild(overlayEl);
  document.documentElement.appendChild(badgeEl);
}

export function highlightElement(target: Element | null): void {
  if (!overlayEl) return;

  if (!target) {
    overlayEl.style.display = 'none';
    return;
  }

  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  overlayEl.style.display = 'block';
  overlayEl.style.left = `${rect.left}px`;
  overlayEl.style.top = `${rect.top}px`;
  overlayEl.style.width = `${rect.width}px`;
  overlayEl.style.height = `${rect.height}px`;
}

/** Outlines the element a left click would open and labels it with that component's source. */
export function updateHighlight(
  node: ComponentNode | null,
  mouseX?: number,
  mouseY?: number,
): void {
  if (!overlayEl || !badgeEl) return;

  if (!node) {
    overlayEl.style.display = 'none';
    badgeEl.style.display = 'none';
    return;
  }

  highlightElement(node.element);

  const rect = node.element.getBoundingClientRect();
  const { comp, line } = node;
  const displayPath = normalizePath(node.file);
  const editorLabel = getEditorLabel(getPreferredEditor());

  badgeEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="color: #38bdf8; font-weight: 700; font-size: 12px;">&lt;${comp}&gt;</span>
      <span style="color: #94a3b8; font-size: 11px;">${displayPath}:${line}</span>
    </div>
    <div style="color: #64748b; font-size: 10px; margin-top: 2px;">⌥ Click to open in ${editorLabel} • ⌥ Right-click for tree</div>
  `;

  badgeEl.style.display = 'block';
  const badgeWidth = badgeEl.offsetWidth || 280;
  const badgeHeight = badgeEl.offsetHeight || 44;
  const BADGE_PADDING = 12;

  let badgeLeft: number;
  let badgeTop: number;

  if (mouseX !== undefined && mouseY !== undefined) {
    // Follow the cursor, flipping to the opposite side when it would overflow.
    badgeLeft = mouseX + 14;
    if (badgeLeft + badgeWidth > window.innerWidth - BADGE_PADDING) {
      badgeLeft = mouseX - badgeWidth - 14;
    }

    badgeTop = mouseY + 16;
    if (badgeTop + badgeHeight > window.innerHeight - BADGE_PADDING) {
      badgeTop = mouseY - badgeHeight - 14;
    }
  } else {
    badgeLeft = rect.left;
    if (badgeLeft + badgeWidth > window.innerWidth - BADGE_PADDING) {
      badgeLeft = window.innerWidth - badgeWidth - BADGE_PADDING;
    }

    badgeTop = rect.top - badgeHeight - 6;
    if (badgeTop < BADGE_PADDING) {
      badgeTop = rect.bottom + 6;
      if (badgeTop + badgeHeight > window.innerHeight - BADGE_PADDING) {
        badgeTop = window.innerHeight - badgeHeight - BADGE_PADDING;
      }
    }
  }

  badgeLeft = Math.max(
    BADGE_PADDING,
    Math.min(badgeLeft, window.innerWidth - badgeWidth - BADGE_PADDING),
  );
  badgeTop = Math.max(
    BADGE_PADDING,
    Math.min(badgeTop, window.innerHeight - badgeHeight - BADGE_PADDING),
  );

  badgeEl.style.left = `${badgeLeft}px`;
  badgeEl.style.top = `${badgeTop}px`;
}

export function hideBadge(): void {
  if (badgeEl) badgeEl.style.display = 'none';
}

export function showOpeningFeedback(): void {
  if (!badgeEl) return;
  const editorLabel = getEditorLabel(getPreferredEditor());
  badgeEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; color: #22c55e;">
      <span style="font-weight: 700; font-size: 12px;">✓ Opening in ${editorLabel}...</span>
    </div>
  `;
  badgeEl.style.borderColor = 'rgba(34, 197, 94, 0.6)';
}

export function resetBadgeFeedback(): void {
  if (badgeEl) {
    badgeEl.style.borderColor = 'rgba(56, 189, 248, 0.35)';
  }
}
