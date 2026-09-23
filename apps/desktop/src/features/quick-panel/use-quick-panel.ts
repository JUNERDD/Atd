import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type RefCallback,
} from 'react';
import type { QuickGroup } from './quick-options';
import type { TriggerState } from './trigger';

/**
 * Imperative keyboard surface the editor drives while the quick panel is open.
 * Keys never go through cmdk; the editor forwards them here and falls through on `false`.
 */
export interface QuickPanelHandle {
  /** Moves the active option, skipping disabled rows; false when the panel is closed (key falls through). */
  move(delta: 1 | -1): boolean;
  /** Runs the active option exactly like a click; false when closed or nothing is selectable (Enter then sends). */
  select(): boolean;
}

/** Combobox wiring for the editor content: the listbox and its active option. */
export interface QuickPanelAria {
  controls: string;
  activeDescendant?: string;
}

/**
 * Whether the panel shows for this trigger. During an active run `@` and an inline `/` stay plain
 * text (chips cannot be sent then), while a leading `/` still opens with quick commands only.
 */
export function isQuickPanelOpen(trigger: TriggerState | null, running: boolean): boolean {
  if (trigger === null) return false;
  return !running || (trigger.kind === 'slash' && trigger.placement === 'leading');
}

interface Selection {
  /** Candidate signature the choice belongs to; any other signature resets to the first option. */
  key: string;
  value: string;
  /** Pointer choices never scroll, so the list does not move under the cursor. */
  pointer: boolean;
}

// Like cmdk, no `container` limit: the option's nearest scroll container is its `overflow-hidden`
// group, not the list viewport, so a limited scroll would never move the list.
const NEAREST = { block: 'nearest' } as const;
const START = { block: 'start' } as const;

function signatureOf(groups: readonly QuickGroup[]): string {
  return groups
    .map((group) => {
      const values = group.options.map((option) =>
        option.disabled ? `!${option.value}` : option.value,
      );
      return `${group.id}:${values.join(',')}`;
    })
    .join('|');
}

/**
 * Active-option state for the controlled cmdk list. The active option is derived: the last choice
 * while the opening and the candidate signature are unchanged, otherwise the first selectable
 * option, so a new opening and new candidates or groups always start at the top. Option elements are tracked by value because cmdk
 * 1.1 leaves `selectedItemId` unset for a controlled value; their ids become
 * `aria-activedescendant`.
 */
export function useQuickPanel({
  open,
  groups,
  handleRef,
  onAriaChange,
}: {
  open: boolean;
  groups: readonly QuickGroup[];
  handleRef: Ref<QuickPanelHandle>;
  onAriaChange: (aria: QuickPanelAria | null) => void;
}) {
  // Every opening starts at the first option; the count only moves on open, so a closing panel
  // keeps its highlight while it fades out.
  const [opening, setOpening] = useState({ open, count: 0 });
  if (opening.open !== open) setOpening({ open, count: opening.count + (open ? 1 : 0) });
  const key = `${opening.count}|${signatureOf(groups)}`;
  const selectable = groups.flatMap((group) => group.options).filter((option) => !option.disabled);
  const [selection, setSelection] = useState<Selection>({ key: '', value: '', pointer: false });
  const chosen =
    selection.key === key
      ? selectable.find((option) => option.value === selection.value)
      : undefined;
  const active = chosen ?? selectable[0];
  const activeValue = active?.value ?? '';
  const first = active !== undefined && active === selectable[0];
  const pointer = chosen !== undefined && selection.pointer;

  useImperativeHandle(handleRef, () => ({
    move(delta) {
      if (!open) return false;
      if (!active) return true;
      const index = selectable.indexOf(active);
      const next = selectable[(index + delta + selectable.length) % selectable.length];
      if (next) setSelection({ key, value: next.value, pointer: false });
      return true;
    },
    select() {
      if (!open || !active) return false;
      active.select();
      return true;
    },
  }));

  /** cmdk's pointer selection. It also re-selects the first option after a list change, which
   * the derived reset already covers, so an unchanged value is ignored. */
  const hover = (value: string) => {
    if (value !== activeValue) setSelection({ key, value, pointer: true });
  };

  // The listbox mounts one render after `open` (the Radix portal mounts first), so its node is state.
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const trackOption =
    (value: string): RefCallback<HTMLDivElement> =>
    (node) => {
      if (!node) return;
      nodes.current.set(value, node);
      return () => {
        if (nodes.current.get(value) === node) nodes.current.delete(value);
      };
    };

  const latestAria = useRef(onAriaChange);
  const reported = useRef('');
  const scrolled = useRef('');
  useLayoutEffect(() => {
    latestAria.current = onAriaChange;
  });
  useLayoutEffect(() => {
    const option = open ? nodes.current.get(activeValue) : undefined;
    const target = `${key}\n${activeValue}`;
    if (option && list) {
      if (!pointer && scrolled.current !== target) {
        // The first option also brings its group heading back into view.
        if (first) list.scrollIntoView(START);
        option.scrollIntoView(NEAREST);
      }
      scrolled.current = target;
    } else if (!open) scrolled.current = '';
    const aria = open && list ? { controls: list.id, activeDescendant: option?.id } : null;
    const signature = aria ? `${aria.controls}\n${aria.activeDescendant ?? ''}` : '';
    if (signature === reported.current) return;
    reported.current = signature;
    latestAria.current(aria);
  }, [open, list, key, activeValue, pointer, first]);

  return { activeValue, hover, setList, trackOption };
}
