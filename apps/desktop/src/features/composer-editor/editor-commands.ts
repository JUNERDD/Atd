import type { ChangeSpec, EditorState, TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { addChips, chipEntry, chipTable, leadingSkillEnd, tokenOf } from './chip-state';
import type { Chip } from './draft';
import { currentTrigger, dismissTrigger } from './trigger-field';

/** Edits the quick panel applies to the composer editor; stable for the editor's lifetime. */
export interface ComposerEditorCommands {
  /** One transaction: replaces the active trigger text with chip tokens (space-separated, one trailing space).
   *  A skill chip is pinned at the start, replaces an existing skill chip, and its `/query` text is removed. */
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
  const skill = chips.find((chip) => chip.kind === 'skill');
  const entries = chips
    .filter((chip) => chip === skill || chip.kind !== 'skill')
    .map((chip) => chipEntry(chip));
  const skillEntry = entries.find((entry) => entry.chip === skill);
  const others = entries.filter((entry) => entry !== skillEntry);
  const { from, to, trigger } = targetRange(state);
  const before = state.sliceDoc(from - 1, from);
  const after = state.sliceDoc(to, to + 1);
  let inserted = others.map((entry) => tokenOf(entry.id)).join(' ');
  if (inserted) {
    // A caret insertion keeps chips apart from adjacent words; one space always follows.
    if (!trigger && before && !/\s/.test(before)) inserted = ` ${inserted}`;
    if (!/\s/.test(after)) inserted += ' ';
  }
  const changes: ChangeSpec[] = [];
  const skillEnd = leadingSkillEnd(state.doc, state.field(chipTable));
  if (skillEntry && (skillEnd || from > 0))
    changes.push({ from: 0, to: skillEnd, insert: tokenOf(skillEntry.id) });
  else if (skillEntry) inserted = tokenOf(skillEntry.id) + inserted;
  changes.push({ from: Math.max(from, skillEnd), to, insert: inserted });
  const changeSet = state.changes(changes);
  return {
    changes: changeSet,
    selection: { anchor: changeSet.mapPos(to, 1) },
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
