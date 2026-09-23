import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { FileRef } from '../../electron/agent/task-schema';

/** The composer's attachment row: files chosen with the attach button, each removable. */
export function ComposerAttachments({
  files,
  onRemove,
}: {
  files: FileRef[];
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation('panel');
  if (!files.length) return null;
  return (
    <ScrollArea className="composer-attachments" viewportClassName="max-h-[inherit]" gutter>
      <ul className="attachment-list" aria-label={t('composer.attachedContext')}>
        {files.map((file) => (
          <li className="attachment-chip" key={file.id}>
            <span title={file.name}>{file.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('composer.removeFile', { name: file.name })}
              onClick={() => onRemove(file.id)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
