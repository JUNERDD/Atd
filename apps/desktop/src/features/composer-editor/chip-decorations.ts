import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { addChips, chipTable, chipTokens } from './chip-state';
import { ChipWidget } from './chip-widget';

function decorate(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, id, chip } of chipTokens(state.doc.toString(), state.field(chipTable)))
    builder.add(from, to, Decoration.replace({ widget: new ChipWidget(id, chip) }));
  return builder.finish();
}

/**
 * Chip widgets derived from the tokens in the text, also registered as atomic ranges so cursor
 * motion skips a chip and deletion removes it whole. While an IME composes, the set is only
 * mapped: composed text never contains tokens, and redrawing widgets beside an active
 * composition is what corrupts it.
 */
export const chipDecorations = StateField.define<DecorationSet>({
  create: decorate,
  update(decorations, transaction) {
    if (transaction.isUserEvent('input.type.compose')) return decorations.map(transaction.changes);
    return transaction.docChanged || transaction.effects.some((effect) => effect.is(addChips))
      ? decorate(transaction.state)
      : decorations;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});
