import { EditorState, Facet, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  chipTable,
  hasToken,
  plainText,
  segmentText,
  SENTINELS,
  serializedLength,
  tableAfter,
} from './chip-state';

/** Maximum serialized length: the IPC limit for the text this composer sends. */
export const textLimit = Facet.define<number, number>({
  combine: (values) => Math.min(Number.POSITIVE_INFINITY, ...values),
});

/**
 * Edits stop at the limit like a textarea's `maxLength`, counted on the serialized text. An IME
 * composition is never cut; an overlong composed draft only disables sending. Shrinking edits
 * always pass, so an over-limit draft (the limit drops while a question waits) stays editable.
 */
function withinLimit(transaction: Transaction) {
  if (!transaction.docChanged || transaction.isUserEvent('input.type.compose')) return transaction;
  const start = transaction.startState;
  const write = start.facet(segmentText);
  const next = serializedLength(transaction.newDoc, tableAfter(transaction), write);
  if (next <= start.facet(textLimit)) return transaction;
  return next > serializedLength(start.doc, start.field(chipTable), write) ? [] : transaction;
}

/** Pasted and dropped text: no chip sentinels, one newline form, cut to the room left. */
function clipboardInput(text: string, state: EditorState): string {
  const clean = text.replace(SENTINELS, '').replace(/\r\n?/g, '\n');
  const table = state.field(chipTable);
  const write = state.facet(segmentText);
  const { from, to } = state.selection.main;
  const room =
    state.facet(textLimit) -
    serializedLength(state.doc, table, write) +
    serializedLength(state.doc, table, write, from, to);
  if (clean.length <= room) return clean;
  const cut = Math.max(0, room);
  // Never leave half of a surrogate pair at the cut.
  return clean.slice(0, /[\uD800-\uDBFF]/.test(clean.charAt(cut - 1)) ? cut - 1 : cut);
}

export const inputFilters = [
  EditorState.transactionFilter.of(withinLimit),
  EditorView.clipboardInputFilter.of(clipboardInput),
  EditorView.clipboardOutputFilter.of((text, state) =>
    plainText(text, state.field(chipTable), state.facet(segmentText)),
  ),
  EditorView.domEventHandlers({
    // CodeMirror drops dragged content as its clipboard text, which would turn a chip into its
    // `@name` text and lose the reference, so selections holding a chip are not draggable.
    dragstart(event, view) {
      const { from, to } = view.state.selection.main;
      if (from === to || !hasToken(view.state.sliceDoc(from, to))) return false;
      event.preventDefault();
      return true;
    },
  }),
];
