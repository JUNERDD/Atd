import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { addChips, chipEntry, tokenOf } from './chip-state';
import type { Chip } from './draft';
import { currentTrigger, dismissTrigger } from './trigger-field';

/** Edits the quick panel applies to the composer editor; stable for the editor's lifetime. */
export interface ComposerEditorCommands {
  /**
   * One transaction: replaces the active trigger text, wherever it starts, with chip tokens
   * (space-separated, one trailing space). Every kind, skills included, lands at the trigger, and
   * the same item may be inserted any number of times.
   */
  insertChips(chips: Chip[]): void;
  /** Replaces the active trigger text, e.g. `/model ` to drill. */
  replaceTrigger(text: string): void;
  /** Deletes the active trigger text including leading whitespace (a quick command ran). */
  clearTrigger(): void;
  /** Closes the panel for the current trigger token without editing text (Esc). */
  dismissTrigger(): void;
}

/**
 * The range a selection replaces: the trigger (read fresh, so it covers text composed since the
 * panel last updated), or the cursor when the trigger closed while an async source was loading.
 */
function targetRange(state: EditorState) {
  const trigger = currentTrigger(state);
  const { from, to } = trigger ?? state.selection.main;
  return { from, to, trigger };
}

function insertChipsSpec(state: EditorState, chips: Chip[]): TransactionSpec {
  const entries = chips.map((chip) => chipEntry(chip));
  const { from, to, trigger } = targetRange(state);
  const before = state.sliceDoc(from - 1, from);
  const after = state.sliceDoc(to, to + 1);
  let inserted = entries.map((entry) => tokenOf(entry.id)).join(' ');
  // A caret insertion keeps chips apart from adjacent words; one space always follows. Existing
  // whitespace counts, except a line break: typing would then continue right at the chip.
  if (!trigger && before && !/\s/.test(before)) inserted = ` ${inserted}`;
  if (!/[^\S\n]/.test(after)) inserted += ' ';
  return {
    changes: { from, to, insert: inserted },
    selection: { anchor: from + inserted.length },
    effects: addChips.of(entries),
    scrollIntoView: true,
    userEvent: 'input.complete',
  };
}

/** Commands that act on whichever view is current, so the object itself never changes. */
export function createEditorCommands(currentView: () => EditorView | null): ComposerEditorCommands {
  const replace = (text: string, focus: boolean) => {
    const view = currentView();
    const trigger = view && currentTrigger(view.state);
    if (!view || !trigger) return;
    const { from, to } = trigger;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
      userEvent: 'input.complete',
    });
    if (focus) view.focus();
  };
  return {
    insertChips(chips) {
      const view = currentView();
      if (!view || !chips.length) return;
      view.dispatch(insertChipsSpec(view.state, chips));
      view.focus();
    },
    replaceTrigger: (text) => replace(text, true),
    clearTrigger: () => replace('', false),
    dismissTrigger() {
      currentView()?.dispatch({ effects: dismissTrigger.of(null) });
    },
  };
}
