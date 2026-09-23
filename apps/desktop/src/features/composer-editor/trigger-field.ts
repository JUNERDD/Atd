import { Facet, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { parseTrigger, type CommandIds, type TriggerState } from '../quick-panel/trigger';

/**
 * Quick-command ids the trigger parser recognizes after a leading `/`. The composer provides them,
 * so the editor never imports the command table and its icons.
 */
export const quickCommandIds = Facet.define<CommandIds, CommandIds>({
  combine: (values) => ({
    all: values.flatMap((value) => value.all),
    drillable: values.flatMap((value) => value.drillable),
  }),
});

/** Closes the panel for the current trigger token (Esc) until that token changes. */
export const dismissTrigger = StateEffect.define<null>();
/** Re-reads the trigger once an IME composition has ended. */
export const refreshTrigger = StateEffect.define<null>();

/** A slash command is a few words at most; longer prefixes are never read for one. */
const SLASH_SCAN = 256;

/** The trigger ending at the cursor, ignoring any dismissal; commands edit this range. */
export function currentTrigger(state: EditorState): TriggerState | null {
  const range = state.selection.main;
  if (!range.empty || state.readOnly) return null;
  const head = range.head;
  const line = state.doc.lineAt(head);
  return parseTrigger(
    {
      head,
      start: head <= SLASH_SCAN ? state.sliceDoc(0, head) : null,
      line: state.sliceDoc(line.from, head),
    },
    state.facet(quickCommandIds),
  );
}

interface TriggerSlot {
  /** What the panel shows. */
  trigger: TriggerState | null;
  /** The dismissed token, identified by kind and start. */
  dismissed: { kind: TriggerState['kind']; from: number } | null;
  /** Set while an IME composes; the next non-composing transaction re-reads the trigger. */
  stale: boolean;
}

export const triggerField = StateField.define<TriggerSlot>({
  create: (state) => ({ trigger: currentTrigger(state), dismissed: null, stale: false }),
  update(slot, transaction) {
    let dismissed =
      slot.dismissed && transaction.docChanged
        ? { ...slot.dismissed, from: transaction.changes.mapPos(slot.dismissed.from) }
        : slot.dismissed;
    const dismissing = transaction.effects.some((effect) => effect.is(dismissTrigger));
    if (dismissing && slot.trigger)
      dismissed = { kind: slot.trigger.kind, from: slot.trigger.from };
    // Composition keeps the reported trigger, so the panel neither opens nor closes mid-word.
    if (transaction.isUserEvent('input.type.compose')) return { ...slot, dismissed, stale: true };
    const refreshing =
      slot.stale ||
      transaction.reconfigured ||
      transaction.effects.some((effect) => effect.is(refreshTrigger));
    if (!transaction.docChanged && !transaction.selection && !dismissing && !refreshing)
      return slot;
    const next = currentTrigger(transaction.state);
    if (!next) return { trigger: null, dismissed: null, stale: false };
    if (dismissed?.kind === next.kind && dismissed.from === next.from)
      return { trigger: null, dismissed, stale: false };
    return { trigger: next, dismissed: null, stale: false };
  },
});

export function sameTrigger(a: TriggerState | null, b: TriggerState | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.from !== b.from || a.to !== b.to || a.query !== b.query)
    return false;
  if (a.kind === 'mention' || b.kind === 'mention') return true;
  return (
    a.placement === b.placement &&
    a.drill?.command === b.drill?.command &&
    a.drill?.query === b.drill?.query
  );
}
