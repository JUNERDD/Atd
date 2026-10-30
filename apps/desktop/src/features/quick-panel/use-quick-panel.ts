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
  /**
   * Moves the active option, skipping disabled rows; with none active, ↓ starts at the first
   * option and ↑ at the last. False when the panel is closed (key falls through).
   */
  move(delta: 1 | -1): boolean;
  /**
   * Runs the active option exactly like a click. False when closed or no option is active, so
   * Enter does what it does without the panel (sends, or starts a new line).
   */
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
  /** The opening the choice was made in; a new opening starts at the first result. */
  opening: number;
  /** The query the choice was made for; typing starts over at the first result. */
  query: string;
  value: string;
  /**
   * The candidate signature a pointer choice belongs to: the highlight follows the pointer, so a
   * list that changes under it starts over. Null for a keyboard move or a jump, which follows its
   * option by value while the rows change for the same query (a reply landing, stale rows
   * narrowed or reordered), for as long as that option stays selectable.
   */
  signature: string | null;
  /**
   * Whether the option scrolls into view: keyboard moves do; pointer choices do not, so the list
   * never moves under the cursor, and neither do jumps, which scroll their section's heading.
   */
  reveal: boolean;
}

const NO_SELECTION: Selection = {
  opening: -1,
  query: '',
  value: '',
  signature: null,
  reveal: true,
};

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
 * while it still applies, otherwise the first selectable result (an option in a section), so a
 * new opening and every edit of the query start at the best match. A heading-less action
 * ("Browse files…") is active only once chosen: when it is all that is selectable, no option is
 * active and Enter and Tab keep their editor meaning, so a draft whose `@` matches nothing sends.
 * A keyboard choice is kept by its option's value while the rows change for the same query, so a
 * reply that lands after ↓ never moves the highlight to another row under Enter; once its option
 * is gone or disabled, or the query changes, the choice is dropped for good, so neither a later
 * reply nor the query typed back restores it. A pointer choice lasts only while the query and the
 * candidates are unchanged. Option elements are tracked by value because cmdk 1.1 leaves
 * `selectedItemId` unset for a controlled value; their ids become `aria-activedescendant`. A
 * keyboard reveal takes the scroll over from a running jump.
 */
export function useQuickPanel({
  open,
  query,
  groups,
  sections,
  scroller,
  handleRef,
  onAriaChange,
}: {
  open: boolean;
  /** The text the rows answer (`QuickView.query`). */
  query: string;
  groups: readonly QuickGroup[];
  /** The groups with headings (`sectionsOf`), in list order. */
  sections: readonly QuickSection[];
  /** The pinned row's jump scrolling (quick-panel-sections.tsx). */
  scroller: RefObject<SectionScroller | null>;
  handleRef: Ref<QuickPanelHandle>;
  onAriaChange: (aria: QuickPanelAria | null) => void;
}) {
  // Every opening starts at the first result; the count only moves on open, so a closing panel
  // keeps its highlight while it fades out.
  const [opening, setOpening] = useState({ open, count: 0 });
  if (opening.open !== open) setOpening({ open, count: opening.count + (open ? 1 : 0) });
  const count = opening.count;
  const signature = signatureOf(groups);
  const key = `${count}|${signature}`;
  const selectable = groups.flatMap((group) => group.options).filter((option) => !option.disabled);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const applies =
    selection.opening === count &&
    selection.query === query &&
    (selection.signature === null || selection.signature === signature);
  const chosen = applies
    ? selectable.find((option) => option.value === selection.value)
    : undefined;
  // A choice that no longer applies is forgotten, so neither the same row reappearing nor the
  // query typed back restores it.
  if (selection.opening === count && selection.value !== '' && !chosen)
    setSelection({ ...NO_SELECTION, opening: count });
  // The default is the first selectable result; an action outside the sections never is.
  const active =
    chosen ?? sections.flatMap((item) => item.options).find((option) => !option.disabled);
  const activeValue = active?.value ?? '';
  const first = active !== undefined && active === selectable[0];
  const reveal = chosen === undefined || selection.reveal;
  const section = active ? sections.findIndex((item) => item.options.includes(active)) : -1;

  /** A jump to section `index`: its first selectable option, if any, becomes active, and its
   * heading scrolls into the pinned slot. A section button's click does the same. */
  const jumpTo = (index: number) => {
    if (!open) return;
    const option = sections[index]?.options.find((item) => !item.disabled);
    if (option)
      setSelection({ opening: count, query, value: option.value, signature: null, reveal: false });
    scroller.current?.scrollTo(index);
  };

  useImperativeHandle(handleRef, () => ({
    move(delta) {
      if (!open) return false;
      scroller.current?.stop();
      // From no active option, ↓ lands on the first selectable option and ↑ on the last.
      const index = active ? selectable.indexOf(active) : delta === 1 ? -1 : selectable.length;
      const next = selectable[(index + delta + selectable.length) % selectable.length];
      if (next)
        setSelection({ opening: count, query, value: next.value, signature: null, reveal: true });
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

  /** cmdk's pointer selection. cmdk also re-selects its first item after a list change or once
   * the active option unmounts; that lands on the derived active option (or, with none, on the
   * surface's hidden placeholder), so an unchanged value is ignored. */
  const hover = (value: string) => {
    if (value !== activeValue)
      setSelection({ opening: count, query, value, signature, reveal: false });
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
    const wiring = aria ? `${aria.controls}\n${aria.activeDescendant ?? ''}` : '';
    if (wiring === reported.current) return;
    reported.current = wiring;
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
