import {
  ChangeSet,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  type ChangeSpec,
  type TransactionSpec,
} from '@codemirror/state';
import { chipDecorations } from './chip-decorations';

interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Widens every edit that touches part of a chip token to the whole token, and moves an insertion
 * that falls inside a token to its end. DOM-driven edits always cover whole widgets; this guards
 * the programmatic and multi-step paths that could split a token.
 */
function keepTokensWhole(transaction: Transaction): TransactionSpec | readonly TransactionSpec[] {
  if (!transaction.docChanged) return transaction;
  const start = transaction.startState;
  const tokens = start.field(chipDecorations);
  const edits: Edit[] = [];
  let adjusted = false;
  let movedTo = -1;
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const edit = { from: fromA, to: toA, insert: inserted.toString() };
    tokens.between(fromA, toA, (tokenFrom, tokenTo) => {
      if (edit.from === edit.to) {
        if (tokenFrom < edit.from && edit.from < tokenTo) edit.from = edit.to = tokenTo;
      } else if (tokenFrom < edit.to && tokenTo > edit.from) {
        edit.from = Math.min(edit.from, tokenFrom);
        edit.to = Math.max(edit.to, tokenTo);
      }
    });
    if (edit.from !== fromA || edit.to !== toA) {
      adjusted = true;
      if (edit.from === edit.to) movedTo = edit.from;
    }
    edits.push(edit);
  });
  if (!adjusted) return transaction;
  const changes = ChangeSet.of(merge(edits), start.doc.length);
  const userEvent = transaction.annotation(Transaction.userEvent);
  return {
    changes,
    selection:
      movedTo >= 0
        ? EditorSelection.cursor(changes.mapPos(movedTo, 1))
        : start.selection.map(changes, 1),
    effects: transaction.effects,
    scrollIntoView: transaction.scrollIntoView,
    ...(userEvent ? { userEvent } : {}),
  };
}

/** Widened edits may now overlap; overlapping ones become one edit with their text joined. */
function merge(edits: Edit[]): ChangeSpec[] {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: Edit[] = [];
  for (const edit of sorted) {
    const last = merged.at(-1);
    if (last && edit.from < last.to) {
      last.to = Math.max(last.to, edit.to);
      last.insert += edit.insert;
    } else merged.push({ ...edit });
  }
  return merged;
}

/**
 * Transaction filters run from the lowest precedence to the highest, so tokens are made whole
 * before any other filter (the length limit) sees the edit.
 */
export const chipIntegrity = Prec.lowest(EditorState.transactionFilter.of(keepTokensWhole));
