import { useState } from 'react';
import { Copy, ExternalLink, FileText, FolderOpen, FolderSearch, Plus } from 'lucide-react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import type { Artifact, FileRef } from '../../../electron/agent/task-schema';
import { artifactLocation } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { fileSize } from '../../lib/task-store';
import { agentApi, messageOf } from './use-agent';

export function TaskFiles({
  files,
  onAttach,
}: {
  files: Artifact[];
  onAttach: (file: FileRef) => void;
}) {
  const [feedback, setFeedback] = useState<{ id: string; text: string; error: boolean } | null>(
    null,
  );
  async function act(file: Artifact, operation: 'open' | 'reveal' | 'copy' | 'locate' | 'attach') {
    setFeedback(null);
    try {
      const result = await agentApi().artifact(file.id, operation);
      if (result) onAttach(result);
      if (operation === 'copy') setFeedback({ id: file.id, text: 'Path copied.', error: false });
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
        const description = missing
          ? 'Locate this file to update its path. Your task is still available.'
          : changed
            ? 'Opening uses the current file. Saved messages still describe the original run.'
            : `${fileSize(location.size)} · ${file.partial ? 'Partial output' : 'Available'}${file.relocation ? ' · Re-linked file' : ''}`;
        return (
          <div className="file-result" key={file.id} data-figma-node="433:2044">
            <Item size="sm" variant="outline">
              <ItemMedia variant="icon">
                <FileText className="size-[18px]" />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="block w-full truncate" title={location.name}>
                  {location.name}
                </ItemTitle>
                <ItemDescription className="block truncate" title={description}>
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
                    label="Open"
                    aria-label="Open file"
                    onClick={() => void act(file, 'open')}
                  >
                    <ExternalLink />
                  </IconButton>
                  <IconButton label="Show in folder" onClick={() => void act(file, 'reveal')}>
                    <FolderOpen />
                  </IconButton>
                  <IconButton label="Copy path" onClick={() => void act(file, 'copy')}>
                    <Copy />
                  </IconButton>
                  <IconButton
                    label={changed ? 'Attach latest version' : 'Attach'}
                    aria-label={
                      changed ? 'Attach current file to follow-up' : 'Attach to follow-up'
                    }
                    onClick={() => void act(file, 'attach')}
                  >
                    <Plus />
                  </IconButton>
                </>
              )}
              {(missing || changed) && (
                <IconButton label="Locate file" onClick={() => void act(file, 'locate')}>
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
