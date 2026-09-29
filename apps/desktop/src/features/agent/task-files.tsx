import { useState } from 'react';
import { Copy, ExternalLink, FileText, FolderOpen, FolderSearch, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import type { Artifact, FileRef } from '../../../electron/agent/task-schema';
import { artifactLocation } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { fileSize } from '../../lib/file-size';
import { agentApi } from './use-agent';
import { messageOf } from '../../lib/errors';

export function TaskFiles({
  files,
  onAttach,
}: {
  files: Artifact[];
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  const [feedback, setFeedback] = useState<{ id: string; text: string; error: boolean } | null>(
    null,
  );
  async function act(file: Artifact, operation: 'open' | 'reveal' | 'copy' | 'locate' | 'attach') {
    setFeedback(null);
    try {
      const result = await agentApi().artifact(file.id, operation);
      // Every host resolves the file for each operation; only Attach adds it to the follow-up.
      if (operation === 'attach' && result) onAttach(result);
      if (operation === 'copy') {
        setFeedback({ id: file.id, text: t('files.pathCopied'), error: false });
      }
    } catch (error) {
      setFeedback({ id: file.id, text: messageOf(error), error: true });
    }
  }
  return (
    <div className="task-files">
      {files.map((file) => {
        const location = artifactLocation(file);
        const missing = file.status === 'missing';
        const changed = file.status === 'changed';
        const state = t(file.partial ? 'files.partialOutput' : 'files.available');
        const description = missing
          ? t('files.missing')
          : changed
            ? t('files.changed')
            : `${fileSize(location.size)} · ${state}${file.relocation ? ` · ${t('files.relinked')}` : ''}`;
        return (
          <div className="file-result" key={file.id} data-figma-node="433:2044">
            <Item size="sm" variant="outline">
              <ItemMedia variant="icon">
                <FileText className="size-[18px]" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="block w-full" title={location.name}>
                  {location.name}
                </ItemTitle>
                <ItemDescription className="block" title={description}>
                  {description}
                </ItemDescription>
                {feedback?.id === file.id && (
                  <p
                    role={feedback.error ? 'alert' : 'status'}
                    className={
                      feedback.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
                    }
                  >
                    {feedback.text}
                  </p>
                )}
              </ItemContent>
            </Item>
            <p className="file-result-path">{location.path}</p>
            <div className="message-actions">
              {!missing && (
                <>
                  <IconButton
                    label={t('files.open')}
                    aria-label={t('files.openLabel')}
                    onClick={() => void act(file, 'open')}
                  >
                    <ExternalLink />
                  </IconButton>
                  <IconButton
                    label={t('files.showInFolder')}
                    onClick={() => void act(file, 'reveal')}
                  >
                    <FolderOpen />
                  </IconButton>
                  <IconButton label={t('files.copyPath')} onClick={() => void act(file, 'copy')}>
                    <Copy />
                  </IconButton>
                  <IconButton
                    label={changed ? t('files.attachLatest') : t('files.attach')}
                    aria-label={changed ? t('files.attachLatestLabel') : t('files.attachLabel')}
                    onClick={() => void act(file, 'attach')}
                  >
                    <Plus />
                  </IconButton>
                </>
              )}
              {(missing || changed) && (
                <IconButton label={t('files.locate')} onClick={() => void act(file, 'locate')}>
                  <FolderSearch />
                </IconButton>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
