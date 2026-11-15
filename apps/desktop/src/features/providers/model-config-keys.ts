import type { KeyboardEvent } from 'react';
import { isComposingKey } from '@atd/ui/lib/ime';

export type RootFocusEdge = 'first' | 'last';
export type DrillSubview = 'context' | 'effort' | 'model';

function shouldIgnoreKey(event: KeyboardEvent<HTMLElement>, ignoreShift: boolean): boolean {
  return (
    event.defaultPrevented ||
    isComposingKey(event) ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (ignoreShift && event.shiftKey)
  );
}

function isTextInput(target: EventTarget): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function focusOption(event: KeyboardEvent<HTMLElement>, target: HTMLElement | null | undefined) {
  event.preventDefault();
  target?.focus();
  target?.scrollIntoView?.({ block: 'nearest' });
}

/** Enabled root navigation controls in DOM order inside `ModelConfigPopover`'s root view. */
export function rootNavItems(container: ParentNode | null): HTMLElement[] {
  return [...(container?.querySelectorAll<HTMLElement>('[data-root-item]:not(:disabled)') ?? [])];
}

/** Returns the first or last enabled root navigation item without mutating focus. */
export function focusRootEdge(
  container: ParentNode | null,
  edge: RootFocusEdge,
): HTMLElement | null {
  const items = rootNavItems(container);
  return (edge === 'first' ? items[0] : items.at(-1)) ?? null;
}

/** Handles root arrow/Home/End cycling and ArrowRight subview drilling. */
export function handleRootKeyDown(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  onDrill: (view: DrillSubview) => void,
): void {
  if (shouldIgnoreKey(event, false) || isTextInput(event.target)) return;
  const items = rootNavItems(container);
  if (items.length === 0) return;
  const active =
    document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;

  if (event.key === 'ArrowDown') {
    focusOption(event, active < 0 ? items[0] : items[(active + 1) % items.length]);
  } else if (event.key === 'ArrowUp') {
    focusOption(
      event,
      active < 0 ? items.at(-1) : items[(active - 1 + items.length) % items.length],
    );
  } else if (event.key === 'Home') {
    focusOption(event, items[0]);
  } else if (event.key === 'End') {
    focusOption(event, items.at(-1));
  } else if (event.key === 'ArrowRight' && active >= 0) {
    const drill = items[active]?.dataset.drill;
    if (drill === 'context' || drill === 'effort' || drill === 'model') {
      event.preventDefault();
      onDrill(drill);
    }
  }
}

/** Handles subview ArrowLeft return-to-root symmetry and header ArrowDown/ArrowUp entry. */
export function handleSubviewKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onBack: () => void,
  optionList?: HTMLElement | null,
): void {
  if (shouldIgnoreKey(event, true)) return;
  if (isTextInput(event.target)) {
    if (event.key === 'ArrowLeft' && event.target.value === '') {
      event.preventDefault();
      onBack();
    }
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    onBack();
    return;
  }
  if (
    optionList &&
    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
    !(event.target instanceof Node && optionList.contains(event.target))
  ) {
    const buttons = [...optionList.querySelectorAll<HTMLElement>(':scope > button:not(:disabled)')];
    const target =
      event.key === 'ArrowUp'
        ? buttons.at(-1)
        : (optionList.querySelector<HTMLElement>('[data-checked="true"]:not(:disabled)') ??
          buttons[0]);
    focusOption(event, target);
  }
}
