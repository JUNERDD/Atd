import { useEffect, useEffectEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { folderChip, type AttachedChip } from '../features/composer-editor/draft-attachments';
import { onImportedFiles, type ImportedFiles } from '../lib/imported-files';
import { showErrorToast } from './toast-store';

/**
 * Takes one batch the host imported or registered: each refused item reports why, and the files
 * and folders go through `attach`, the composer's path for picked files, so the same limits apply.
 */
export function receiveImported(
  { files, folders, failures }: ImportedFiles,
  attach: (chips: AttachedChip[]) => void,
  t: TFunction<'panel'>,
): void {
  for (const { name, reason } of failures)
    showErrorToast(t(`composer.importFailed.${reason}`, { name }));
  const chips: AttachedChip[] = [
    ...files.map((file): AttachedChip => ({ kind: 'file', file })),
    ...folders.map(folderChip),
  ];
  if (chips.length) attach(chips);
}

/** Receives what the host imported from a drop, a paste or the Finder service. */
export function useImportedFiles(attach: (chips: AttachedChip[]) => void): void {
  const { t } = useTranslation('panel');
  const receive = useEffectEvent((batch: ImportedFiles) => receiveImported(batch, attach, t));
  useEffect(() => onImportedFiles((batch) => receive(batch)), []);
}
