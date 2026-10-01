import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileRef } from '../client/agent/task-schema';
import { onImportedFiles, type ImportedFiles } from '../lib/imported-files';
import { showErrorToast } from './toast-store';

/**
 * Receives files the host imported from a drop or paste: each refused file reports why, and the
 * imported ones go through `attach`, the composer's path for picked files, so the same limit
 * applies.
 */
export function useImportedFiles(attach: (files: FileRef[]) => void): void {
  const { t } = useTranslation('panel');
  const receive = useEffectEvent(({ files, failures }: ImportedFiles) => {
    for (const { name, reason } of failures)
      showErrorToast(t(`composer.importFailed.${reason}`, { name }));
    if (files.length) attach(files);
  });
  useEffect(() => onImportedFiles((batch) => receive(batch)), []);
}
