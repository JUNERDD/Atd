import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { addChips, chipEntry, tokenOf } from './chip-state';
import type { Chip } from './draft';
import type { AttachedChip } from './draft-attachments';
import { currentTrigger, dismissTrigger } from './trigger-field';

/**
 * Edits the quick panel applies to the composer editor; stable for the editor's lifetime and free
 * of `this`, so callers may pass them on as callbacks.
 */
export interface ComposerEditorCommands {
  /**
   * One transaction: replaces the active trigger text, wherever it starts, with chip tokens
   * (space-separated, one trailing space). Every kind, skills included, lands at the trigger, and
   * the same item may be inserted any number of times.
   */
  insertChips: (chips: Chip[]) => void;
  /**
   * Inserts attached files and folders (picked, captured, dropped, pasted or sent from Finder) as
   * chips at the caret, like `insertChips` but leaving an open trigger's text in place, and
   * focuses the editor.
   */
  attachChips: (chips: AttachedChip[]) => void;
  /** Replaces the active trigger text, e.g. `/model ` to drill. */
  replaceTrigger: (text: string) => void;
  /** Deletes the active trigger text including leading whitespace (a quick command ran). */
  clearTrigger: () => void;
  /** Closes the panel for the current trigger token without editing text (Esc). */
  dismissTrigger: () => void;
  /**
   * Types `@` at the caret, after a space when the caret follows a word, and focuses the editor,
   * so the trigger opens the mention panel as if the user had typed it (the attach menu's
   * Mention item).
   */
  insertMention: () => void;
}

/**
 * The range inserted chips replace: the trigger (read fresh, so it covers text composed since the
 * panel last updated), or the selection when the trigger closed while an async source was loading
 * or the chips do not come from the panel (`atTrigger` false).
 */
function targetRange(state: EditorState, atTrigger: boolean) {
  const trigger = atTrigger ? currentTrigger(state) : null;
  const { from, to } = trigger ?? state.selection.main;
  return { from, to, trigger };
}

function insertChipsSpec(state: EditorState, chips: Chip[], atTrigger: boolean): TransactionSpec {
  const entries = chips.map((chip) => chipEntry(chip));
  const { from, to, trigger } = targetRange(state, atTrigger);
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
  const insert = (chips: Chip[], atTrigger: boolean) => {
    const view = currentView();
    if (!view || !chips.length) return;
    view.dispatch(insertChipsSpec(view.state, chips, atTrigger));
    view.focus();
  };
  return {
    insertChips: (chips) => insert(chips, true),
    attachChips: (chips) => insert(chips, false),
    replaceTrigger: (text) => replace(text, true),
    clearTrigger: () => replace('', false),
    dismissTrigger() {
      currentView()?.dispatch({ effects: dismissTrigger.of(null) });
    },
    insertMention() {
      const view = currentView();
      if (!view || view.state.readOnly) return;
      const { from, to } = view.state.selection.main;
      const before = view.state.sliceDoc(from - 1, from);
      const insert = before && !/\s/.test(before) ? ' @' : '@';
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
        userEvent: 'input.type',
      });
      view.focus();
    },
  };
}
