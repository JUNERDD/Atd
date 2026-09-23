import { StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { TriggerState } from '../quick-panel/trigger';
import { triggerField } from './trigger-field';

/** Colour only: text typed next to the command never joins the mark. */
const commandMark = Decoration.mark({ class: 'cm-composer-command', inclusive: false });

function decorate(trigger: TriggerState | null): DecorationSet {
  const command = trigger?.kind === 'slash' ? trigger.command : null;
  return command ? Decoration.set(commandMark.range(command.from, command.to)) : Decoration.none;
}

/**
 * Colours the recognized leading command (`/model` in `/model 5.`) while the panel shows its
 * trigger; a dismissed trigger is sent as plain text, so it loses the colour. The trigger slot is
 * a new object on every composing transaction, so this is a field rather than a computed facet:
 * while an IME composes, the mark is only mapped, as `chipDecorations` does.
 */
export const commandMarks = StateField.define<DecorationSet>({
  create: (state) => decorate(state.field(triggerField).trigger),
  update(marks, transaction) {
    if (transaction.isUserEvent('input.type.compose')) return marks.map(transaction.changes);
    const slot = transaction.state.field(triggerField);
    // An unchanged slot means an unchanged document and trigger.
    return slot === transaction.startState.field(triggerField) ? marks : decorate(slot.trigger);
  },
  provide: (field) => EditorView.decorations.from(field),
});
