import type { EditorView } from '@codemirror/view';
import { isImageMime } from '@atd/agent-contracts';
import { showErrorToast } from '../../components/toast-store';
import { addChips, chipEntry, chipTable, chipTokens, tokenOf } from './chip-state';
import type { Chip } from './draft';
import type { FileChip } from './draft-attachments';

/** Whether a chip opens the screenshot editor on click: a file chip holding an image. */
export function isEditableImage(chip: Chip): chip is FileChip {
  return chip.kind === 'file' && isImageMime(chip.file.type);
}

/** One capture overlay at a time: a click while an edit is open does nothing. */
let editing = false;

/**
 * Edits the image of chip `id` on the capture overlay and, unless the edit was cancelled, puts the
 * edited image in that chip's place, keeping a screenshot's context. The edit is a new chip entry
 * so undo brings back the original image; a chip deleted or a view replaced meanwhile is left as is.
 */
export async function editImageChip(view: EditorView, id: string, chip: FileChip) {
  const desktop = window.desktop;
  if (!desktop || editing) return;
  editing = true;
  try {
    const edited = await desktop.editScreenshot(chip.file.id);
    if (edited && view.dom.isConnected) replaceChip(view, id, { ...chip, file: edited.file });
  } catch (error) {
    showErrorToast(error);
  }
  editing = false;
}

function replaceChip(view: EditorView, id: string, chip: Chip) {
  const entry = chipEntry(chip);
  const { state } = view;
  const changes = [...chipTokens(state.doc.toString(), state.field(chipTable))]
    .filter((token) => token.id === id)
    .map(({ from, to }) => ({ from, to, insert: tokenOf(entry.id) }));
  if (!changes.length) return;
  view.dispatch({ changes, effects: addChips.of([entry]), userEvent: 'input.replace' });
}
