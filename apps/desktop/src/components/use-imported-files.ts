import { useEffect, useEffectEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { MAX_ATTACHMENTS, MAX_FOLDERS } from '@atd/agent-contracts';
import { folderChip, type AttachedChip } from '../features/composer-editor/draft-attachments';
import { recordErrorBreadcrumb } from '../lib/errors';
import { onImportedFiles, type ImportedFiles } from '../lib/imported-files';
import { showErrorToast, showToast } from './toast-store';

function openFilesPrivacySettings(): void {
  void window.desktop?.settings.openFilesPrivacySettings().catch(showErrorToast);
}

/**
 * Shows one toast per item the host did not add: why, as its title, and the item's name below. A
 * file macOS refused to read (`denied`) offers System Settings, the only place the user can allow
 * it. The items past what one gesture adds share one toast that names the limits, as a pick over
 * the limit does.
 */
export function reportImportFailures(
  failures: ImportedFiles['failures'],
  t: TFunction<'panel'>,
): void {
  let tooMany = 0;
  for (const { name, reason } of failures) {
    if (reason === 'tooMany') {
      tooMany += 1;
      continue;
    }
    const text = t(`composer.importFailed.${reason}`);
    recordErrorBreadcrumb('unhandled_error', `${text}: ${name}`);
    showToast({
      kind: 'error',
      text,
      detail: name,
      ...(reason === 'denied'
        ? { action: { label: t('composer.openPrivacySettings'), run: openFilesPrivacySettings } }
        : {}),
    });
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
