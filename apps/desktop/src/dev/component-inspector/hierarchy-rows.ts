/**
 * Dev-only click-to-component inspector: hierarchy row list rendering.
 */

import { getEditorLabel, getPreferredEditor, openInEditor } from './editor';
import type { ComponentNode } from './component-chain';
import { highlightElement, normalizePath } from './overlay';

export function createHierarchyRows(
  hierarchy: ComponentNode[],
  target: Element,
  onNodeOpened: () => void,
): HTMLDivElement {
  const list = document.createElement('div');
  list.style.cssText = `
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 8px;
  `;

  hierarchy.forEach((item, idx) => {
    const isTarget = idx === 0;
    const isRoot = idx === hierarchy.length - 1;

    let branch = '├─ ';
    if (isTarget) branch = '● ';
    else if (isRoot) branch = '└─ ';

    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      padding-left: ${8 + idx * 14}px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      transition: background 0.15s ease, color 0.15s ease;
      position: relative;
    `;

    const displayPath = normalizePath(item.file);

    row.innerHTML = `
      <span style="color: #52525b; user-select: none;">${branch}</span>
      <span style="color: ${isTarget ? '#38bdf8' : '#e4e4e7'}; font-weight: 700;">&lt;${item.comp}&gt;</span>
      ${
        isTarget
          ? `<span style="background: rgba(56, 189, 248, 0.18); color: #38bdf8; font-size: 10px; padding: 1px 5px; border-radius: 4px; font-weight: 600;">target</span>`
          : ''
      }
      <span style="color: #71717a; font-size: 11px; margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">
        ${displayPath}:${item.line}
      </span>
    `;

    row.addEventListener('mouseenter', () => {
      row.style.background = 'rgba(56, 189, 248, 0.14)';
      highlightElement(item.element);
    });

    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent';
      highlightElement(target);
    });

    row.addEventListener('click', (event) => {
      event.stopPropagation();
      const currentLabel = getEditorLabel(getPreferredEditor());
      row.style.background = 'rgba(34, 197, 94, 0.25)';
      row.innerHTML = `
        <span style="color: #22c55e; font-weight: 700; padding: 2px 0;">✓ Opening &lt;${item.comp}&gt; in ${currentLabel}...</span>
      `;
      openInEditor(item.file, item.line, item.col);
      window.setTimeout(onNodeOpened, 350);
    });

    list.appendChild(row);
  });

  return list;
}
