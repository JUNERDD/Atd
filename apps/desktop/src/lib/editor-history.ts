import { historyField, redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import type { EditCommand } from '../../electron/contract';

/**
 * Moves the history of the CodeMirror editor rendered in `host`. Returns false when that editor
 * keeps no history, so the caller runs the native command instead.
 */
export function runEditorHistory(host: HTMLElement, command: EditCommand): boolean {
  const view = EditorView.findFromDOM(host);
  if (!view?.state.field(historyField, false)) return false;
  (command === 'undo' ? undo : redo)(view);
  return true;
}
