import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { isComposingKey } from '@atd/ui/lib/ime';
import { createPointerGate, type PointerGate } from '@atd/ui/lib/pointer-gate';

export type ModelConfigView = 'root' | 'context' | 'effort' | 'model';
export type RootFocusEdge = 'first' | 'last';
export type DrillSubview = 'context' | 'effort' | 'model';

type RefBox<T> = { current: T };
type ViewDom = {
  root: HTMLElement | null;
  optionList: HTMLElement | null;
  modelView: HTMLElement | null;
};

type SubviewNavOpts = {
  onBack: () => void;
  optionList?: HTMLElement | null | undefined;
  modelView?: HTMLElement | null | undefined;
};

const LIST_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);
const NAV_KEYS = new Set([...LIST_KEYS, 'ArrowLeft', 'ArrowRight', 'Tab']);
const ROOT_ITEM = '[data-root-item]:not(:disabled)';
const ROW_SELECTOR = `${ROOT_ITEM}, .model-config-effort-option:not(:disabled)`;
const ANY_ROW_SELECTOR = '[data-root-item], .model-config-effort-option';

function shouldIgnoreKey(event: KeyboardEvent<HTMLElement>, ignoreShift: boolean): boolean {
  if (event.defaultPrevented || isComposingKey(event)) return true;
  return event.metaKey || event.ctrlKey || event.altKey || (ignoreShift && event.shiftKey);
}

function isTextInput(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** Focuses `target` without scrolling the outer container, or falls back to `fallback`. */
export function focusElement(
  target: HTMLElement | null | undefined,
  fallback?: HTMLElement | null,
): void {
  if (!target) {
    fallback?.focus({ preventScroll: true });
    return;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: 'nearest' });
}

function queryAll(parent: ParentNode | null, selector: string): HTMLElement[] {
  return [...(parent?.querySelectorAll<HTMLElement>(selector) ?? [])];
}

function checkedOption(optionList: ParentNode | null): HTMLElement | null {
  return optionList?.querySelector<HTMLElement>('[data-checked="true"]:not(:disabled)') ?? null;
}

function backButton(parent: ParentNode): HTMLElement | null {
  return parent.querySelector<HTMLElement>('.model-config-back-header button:not(:disabled)');
}

function activeIndex(items: readonly HTMLElement[]): number {
  return document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1;
}

function modelViewTabTargets(viewEl: HTMLElement): HTMLElement[] {
  const backBtn = backButton(viewEl);
  const controls = queryAll(
    viewEl,
    '[data-slot="command-input-wrapper"] input:not(:disabled), [data-slot="command-input-wrapper"] button:not(:disabled)',
  );
  return [...(backBtn ? [backBtn] : []), ...controls];
}

function cycleTabFocus(
  event: KeyboardEvent<HTMLElement>,
  candidates: readonly HTMLElement[],
): void {
  event.preventDefault();
  if (candidates.length === 0) return;
  const i = activeIndex(candidates);
  const next = event.shiftKey
    ? candidates[i <= 0 ? candidates.length - 1 : i - 1]
    : candidates[i < 0 ? 0 : (i + 1) % candidates.length];
  focusElement(next);
}

function moveListFocus(event: KeyboardEvent<HTMLElement>, items: readonly HTMLElement[]): boolean {
  const { key } = event;
  if (!LIST_KEYS.has(key) || items.length === 0) return false;
  const i = activeIndex(items);
  let target: HTMLElement | undefined;
  if (key === 'ArrowDown') target = i >= 0 ? items[(i + 1) % items.length] : items[0];
  else if (key === 'ArrowUp')
    target = i >= 0 ? items[(i - 1 + items.length) % items.length] : items.at(-1);
  else target = key === 'Home' ? items[0] : items.at(-1);
  event.preventDefault();
  focusElement(target);
  return true;
}

function dispatchCmdkKey(modelView: ParentNode, key: string): void {
  modelView
    .querySelector('[cmdk-root]')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function blurRowToContent(content: HTMLElement): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.matches(ANY_ROW_SELECTOR)) {
    content.focus({ preventScroll: true });
  }
}

/** Enabled root navigation controls in DOM order inside `ModelConfigPopover`'s root view. */
export function rootNavItems(container: ParentNode | null): HTMLElement[] {
  return queryAll(container, ROOT_ITEM);
}

/** Returns the first or last enabled root navigation item without mutating focus. */
export function focusRootEdge(
  container: ParentNode | null,
  edge: RootFocusEdge,
): HTMLElement | null {
  const items = rootNavItems(container);
  return (edge === 'first' ? items[0] : items.at(-1)) ?? null;
}

/** Resolves which element should receive focus when a popover view mounts. */
export function resolveViewFocusTarget(
  opts: ViewDom & {
    view: ModelConfigView;
    returnFrom: RefBox<DrillSubview | null>;
    initialRootFocus: RefBox<RootFocusEdge | null>;
    rootRows: Record<DrillSubview, HTMLElement | null>;
  },
): HTMLElement | null {
  if (opts.view === 'root') {
    if (opts.returnFrom.current) return opts.rootRows[opts.returnFrom.current] ?? null;
    const edge = opts.initialRootFocus.current;
    opts.initialRootFocus.current = null;
    return edge ? focusRootEdge(opts.root, edge) : null;
  }
  if (opts.view === 'model') return opts.modelView?.querySelector('input') ?? null;
  return (
    checkedOption(opts.optionList) ??
    opts.optionList?.querySelector<HTMLElement>('button:not(:disabled)') ??
    null
  );
}

/** Moves focus into the currently open view when ArrowDown/ArrowUp is pressed on the trigger. */
export function focusOpenViewEdge(
  opts: ViewDom & { view: ModelConfigView; edge: RootFocusEdge },
): void {
  if (opts.view === 'root') return focusElement(focusRootEdge(opts.root, opts.edge));
  if (opts.view === 'model') return focusElement(opts.modelView?.querySelector('input'));
  const buttons = queryAll(opts.optionList, ':scope > button:not(:disabled)');
  focusElement(
    opts.edge === 'last' ? buttons.at(-1) : (checkedOption(opts.optionList) ?? buttons[0]),
  );
}

/** Whether a keydown inside the popover is a navigation key rather than text entry. */
export function isPopoverNavKey(event: KeyboardEvent<HTMLElement>): boolean {
  if (isComposingKey(event) || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (NAV_KEYS.has(event.key)) return true;
  return (event.key === 'Enter' || event.key === ' ') && !isTextInput(event.target);
}

/** Handles root Tab cycling, arrow/Home/End navigation, and ArrowRight subview drilling. */
export function handleRootKeyDown(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  onDrill: (view: DrillSubview) => void,
): void {
  if (shouldIgnoreKey(event, event.key !== 'Tab')) return;
  const form =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-alias-save-form]')
      : null;
  if (form) {
    if (event.key === 'Tab')
      cycleTabFocus(event, queryAll(form, 'input:not(:disabled), button:not(:disabled)'));
    return;
  }
  if (isTextInput(event.target)) return;
  if (event.key === 'Tab') {
    cycleTabFocus(event, queryAll(container, 'button:not(:disabled), input:not(:disabled)'));
    return;
  }
  const items = rootNavItems(container);
  if (moveListFocus(event, items) || event.key !== 'ArrowRight') return;
  const i = activeIndex(items);
  const drill = i >= 0 ? items[i]?.dataset.drill : undefined;
  if (drill === 'context' || drill === 'effort' || drill === 'model') {
    event.preventDefault();
    onDrill(drill);
  }
}

/** Handles subview Tab cycling, arrow/Home/End option movement, and ArrowLeft/Backspace return. */
export function handleSubviewKeyDown(
  event: KeyboardEvent<HTMLElement>,
  { onBack, optionList, modelView }: SubviewNavOpts,
): void {
  if (shouldIgnoreKey(event, event.key !== 'Tab')) return;
  if (isTextInput(event.target)) {
    if (event.key === 'ArrowLeft' && event.target.value === '') {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key === 'Tab' && modelView) cycleTabFocus(event, modelViewTabTargets(modelView));
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
    event.preventDefault();
    onBack();
    return;
  }
  if (optionList) {
    const buttons = queryAll(optionList, ':scope > button:not(:disabled)');
    if (event.key === 'Tab') {
      const option =
        buttons.find((b) => b === document.activeElement) ??
        checkedOption(optionList) ??
        buttons[0];
      cycleTabFocus(
        event,
        [backButton(event.currentTarget), option].filter((el): el is HTMLElement => el != null),
      );
      return;
    }
    moveListFocus(event, buttons);
  } else if (modelView) {
    if (event.key === 'Tab') cycleTabFocus(event, modelViewTabTargets(modelView));
    else if (LIST_KEYS.has(event.key)) {
      event.preventDefault();
      focusElement(modelView.querySelector<HTMLElement>('input:not(:disabled)'));
      dispatchCmdkKey(modelView, event.key);
    } else if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      dispatchCmdkKey(modelView, 'Enter');
    }
  }
}

/** Coordinates pointer movement with keyboard navigation and syncs focus onto the hovered row. */
export function handlePopoverPointerMove(
  event: PointerEvent<HTMLElement>,
  pointerGate: PointerGate,
): void {
  if (!pointerGate.allowMove(event)) return;
  const active = document.activeElement;
  if (isTextInput(active) || active?.closest('[data-alias-save-form]')) return;
  const row = (event.target instanceof Element ? event.target : null)?.closest<HTMLElement>(
    ROW_SELECTOR,
  );
  if (row) {
    if (active !== row) row.focus({ preventScroll: true });
  } else blurRowToContent(event.currentTarget);
}

/** Clears row focus back to the popover surface when the pointer leaves while unlocked. */
export function handlePopoverPointerLeave(
  event: PointerEvent<HTMLElement>,
  pointerGate: PointerGate,
): void {
  if (pointerGate.allowLeave(event)) blurRowToContent(event.currentTarget);
}

/** Owns view, focus-restore, and keyboard-vs-pointer coordination for `ModelConfigPopover`. */
export function useModelConfigNavState(disabled: boolean) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ModelConfigView>('root');
  const [switched, setSwitched] = useState(false);
  const [pointerGate, setPointerGate] = useState(() => createPointerGate(false));
  const returnFrom = useRef<DrillSubview | null>(null);
  const initialRootFocus = useRef<RootFocusEdge | null>(null);

  const show = (next: ModelConfigView, isSwitch = true) => {
    returnFrom.current = isSwitch && next === 'root' && view !== 'root' ? view : null;
    if (isSwitch) pointerGate.lock();
    setView(next);
    setSwitched(isSwitch);
  };

  return {
    open,
    setOpen,
    view,
    switched,
    show,
    onOpenChange: (next: boolean) => {
      setOpen(next);
      if (next) {
        if (initialRootFocus.current !== null) pointerGate.lock();
        else setPointerGate(createPointerGate(false));
        show('root', false);
      }
    },
    onTriggerClick: (event: MouseEvent<HTMLElement>) => {
      if (!open && event.detail === 0) {
        initialRootFocus.current = 'first';
        pointerGate.lock();
      }
    },
    onTriggerKeyDown: (event: KeyboardEvent<HTMLElement>, dom: ViewDom) => {
      if (
        disabled ||
        isComposingKey(event) ||
        (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
      )
        return;
      event.preventDefault();
      pointerGate.lock();
      const edge: RootFocusEdge = event.key === 'ArrowUp' ? 'last' : 'first';
      if (!open) {
        initialRootFocus.current = edge;
        show('root', false);
        setOpen(true);
      } else focusOpenViewEdge({ view, edge, ...dom });
    },
    onOpenAutoFocus: (
      event: Event,
      dom: ViewDom & { rootRows: Record<DrillSubview, HTMLElement | null> },
    ) => {
      event.preventDefault();
      const target = resolveViewFocusTarget({ view, returnFrom, initialRootFocus, ...dom });
      focusElement(target, event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) =>
      handlePopoverPointerMove(event, pointerGate),
    onPointerLeave: (event: PointerEvent<HTMLElement>) =>
      handlePopoverPointerLeave(event, pointerGate),
    onContentKeyDown: (event: KeyboardEvent<HTMLElement>, dom: ViewDom) => {
      if (isPopoverNavKey(event)) pointerGate.lock();
      if (view === 'root') handleRootKeyDown(event, dom.root, show);
      else handleSubviewKeyDown(event, { onBack: () => show('root'), ...dom });
    },
  };
}
