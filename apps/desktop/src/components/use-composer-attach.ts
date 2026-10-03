import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS, MAX_FOLDERS } from '@atd/agent-contracts';
import {
  chipFiles,
  draftFiles,
  folderIds,
  type AttachedChip,
} from '../features/composer-editor/draft-attachments';
import type { ComposerDraft } from '../features/composer-editor/draft';
import type { ComposerEditorCommands } from '../features/composer-editor/editor-commands';
import { showErrorToast } from './toast-store';
import { useImportedFiles } from './use-imported-files';

/**
 * The composer's one path for attached files and folders, whether picked, captured, dropped,
 * pasted or sent from Finder: they become chips at the caret. Files past `room` (what the draft
 * still takes, a screenshot's context included) or folders past the message's cap are refused as
 * a group with a toast, while the other kind of the same batch still attaches.
 */
export function useComposerAttach(draft: ComposerDraft, commands: ComposerEditorCommands) {
  const { t } = useTranslation('panel');
  const room = MAX_ATTACHMENTS - draftFiles(draft).length;
  function attach(chips: AttachedChip[]) {
    const files = chips.flatMap((chip) => (chip.kind === 'file' ? chipFiles(chip) : []));
    const folders = new Set(folderIds(draft));
    for (const chip of chips) if (chip.kind === 'folder') folders.add(chip.folderId);
    const filesFit = files.length <= room;
    const foldersFit = folders.size <= MAX_FOLDERS;
    if (!filesFit) showErrorToast(t('composer.attachLimit'));
    if (!foldersFit) showErrorToast(t('composer.folderLimit', { max: MAX_FOLDERS }));
    commands.attachChips(chips.filter((chip) => (chip.kind === 'file' ? filesFit : foldersFit)));
  }
  useImportedFiles(attach);
  return { room, attach };
}
