import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type RefCallback,
  type RefObject,
} from 'react';
import type { QuickGroup } from './quick-options';
import type { TriggerState } from './trigger';
import type { QuickSection, SectionScroller } from './use-section-pin';

/**
 * Imperative keyboard surface the editor drives while the quick panel is open.
 * Keys never go through cmdk; the editor forwards them here and falls through on `false`.
 */
export interface QuickPanelHandle {
  /** Moves the active option, skipping disabled rows; false when the panel is closed (key falls through). */
  move(delta: 1 | -1): boolean;
  /** Runs the active option exactly like a click; false when closed or nothing is selectable (Enter then sends). */
  select(): boolean;
  /**
   * Moves the active option to the first selectable option of the next or previous section that
   * has one, counting from the active option's section (the heading-less trailing group comes after
   * the last), without wrapping, and scrolls that section's heading into the pinned slot. False
   * only when closed: with nowhere to go it is still true, so ⌘↑ / ⌘↓ never move the caret while
   * the panel is open.
   */
  jump(delta: 1 | -1): boolean;
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
  /**
   * Whether the option scrolls into view: keyboard moves do; pointer choices do not, so the list
   * never moves under the cursor, and neither do jumps, which scroll their section's heading.
   */
  reveal: boolean;
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

/** The nearest section past `from` in direction `delta` with a selectable option; null at the ends. */
function nextSection(sections: readonly QuickSection[], from: number, delta: 1 | -1) {
  for (let index = from + delta; index >= 0 && index < sections.length; index += delta)
    if (sections[index]?.options.some((option) => !option.disabled)) return index;
  return null;
}

/**
 * Active-option state for the controlled cmdk list. The active option is derived: the last choice
 * while the opening and the candidate signature are unchanged, otherwise the first selectable
 * option, so a new opening and new candidates or groups always start at the top. Option elements are tracked by value because cmdk
 * 1.1 leaves `selectedItemId` unset for a controlled value; their ids become
 * `aria-activedescendant`. A keyboard reveal takes the scroll over from a running jump.
 */
export function useQuickPanel({
  open,
  groups,
  sections,
  scroller,
  handleRef,
  onAriaChange,
}: {
  open: boolean;
  groups: readonly QuickGroup[];
  /** The groups with headings (`sectionsOf`), in list order. */
  sections: readonly QuickSection[];
  /** The pinned row's jump scrolling (quick-panel-sections.tsx). */
  scroller: RefObject<SectionScroller | null>;
  handleRef: Ref<QuickPanelHandle>;
  onAriaChange: (aria: QuickPanelAria | null) => void;
}) {
  // Every opening starts at the first option; the count only moves on open, so a closing panel
  // keeps its highlight while it fades out.
  const [opening, setOpening] = useState({ open, count: 0 });
  if (opening.open !== open) setOpening({ open, count: opening.count + (open ? 1 : 0) });
  const key = `${opening.count}|${signatureOf(groups)}`;
  const selectable = groups.flatMap((group) => group.options).filter((option) => !option.disabled);
  const [selection, setSelection] = useState<Selection>({ key: '', value: '', reveal: true });
  const chosen =
    selection.key === key
      ? selectable.find((option) => option.value === selection.value)
      : undefined;
  const active = chosen ?? selectable[0];
  const activeValue = active?.value ?? '';
  const first = active !== undefined && active === selectable[0];
  const reveal = chosen === undefined || selection.reveal;
  const section = active ? sections.findIndex((item) => item.options.includes(active)) : -1;

  /** A jump to section `index`: its first selectable option, if any, becomes active, and its
   * heading scrolls into the pinned slot. A section button's click does the same. */
  const jumpTo = (index: number) => {
    if (!open) return;
    const option = sections[index]?.options.find((item) => !item.disabled);
    if (option) setSelection({ key, value: option.value, reveal: false });
    scroller.current?.scrollTo(index);
  };

  useImperativeHandle(handleRef, () => ({
    move(delta) {
      if (!open) return false;
      scroller.current?.stop();
      if (!active) return true;
      const index = selectable.indexOf(active);
      const next = selectable[(index + delta + selectable.length) % selectable.length];
      if (next) setSelection({ key, value: next.value, reveal: true });
      return true;
    },
    select() {
      if (!open || !active) return false;
      active.select();
      return true;
    },
    jump(delta) {
      if (!open) return false;
      // Outside every section, the active option is in the trailing group, after the last one.
      const from = section !== -1 ? section : active ? sections.length : -1;
      const target = nextSection(sections, from, delta);
      if (target !== null) jumpTo(target);
      return true;
    },
  }));

  /** cmdk's pointer selection. It also re-selects the first option after a list change, which
   * the derived reset already covers, so an unchanged value is ignored. */
  const hover = (value: string) => {
    if (value !== activeValue) setSelection({ key, value, reveal: false });
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
      if (reveal && scrolled.current !== target) {
        scroller.current?.stop();
        // The first option also brings its group heading back into view (scroll padding keeps
        // revealed options below the pinned row, so the list still lands at the top).
        if (first) list.scrollIntoView(START);
        option.scrollIntoView(NEAREST);
      }
      scrolled.current = target;
    } else if (!open) scrolled.current = '';
    const aria: QuickPanelAria | null =
      open && list
        ? { controls: list.id, ...(option ? { activeDescendant: option.id } : {}) }
        : null;
    const signature = aria ? `${aria.controls}\n${aria.activeDescendant ?? ''}` : '';
    if (signature === reported.current) return;
    reported.current = signature;
    latestAria.current(aria);
  }, [open, list, key, activeValue, reveal, first, scroller]);

  return {
    activeValue,
    /** The active option's section; null when it is in none (or nothing is selectable). */
    activeSection: section === -1 ? null : section,
    hover,
    jumpTo,
    list,
    setList,
    trackOption,
  };
}
