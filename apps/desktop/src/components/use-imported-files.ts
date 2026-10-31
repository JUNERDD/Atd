import { useEffect, useEffectEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS, MAX_FOLDERS } from '@atd/agent-contracts';
import { folderChip, type AttachedChip } from '../features/composer-editor/draft-attachments';
import { onImportedFiles, type ImportedFiles } from '../lib/imported-files';
import { showErrorToast } from './toast-store';

/**
 * Shows one toast per item the host did not add, naming it and saying why. The items past what
 * one gesture adds share one toast that names the limits, as a pick over the limit does.
 */
export function reportImportFailures(
  failures: ImportedFiles['failures'],
  t: TFunction<'panel'>,
): void {
  let tooMany = 0;
  for (const { name, reason } of failures) {
    if (reason === 'tooMany') tooMany += 1;
    else showErrorToast(t(`composer.importFailed.${reason}`, { name }));
  }
  if (tooMany) {
    const limits = { count: tooMany, max: MAX_ATTACHMENTS, folders: MAX_FOLDERS };
    showErrorToast(t('composer.importFailed.tooMany', limits));
  }
}

/**
 * Takes one batch the host imported or registered: each refused item reports why, and the files
 * and folders go through `attach`, the composer's path for picked files, so the same limits apply.
 */
export function receiveImported(
  { files, folders, failures }: ImportedFiles,
  attach: (chips: AttachedChip[]) => void,
  t: TFunction<'panel'>,
): void {
  reportImportFailures(failures, t);
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
