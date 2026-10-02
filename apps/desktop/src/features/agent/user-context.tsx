import { useTranslation } from 'react-i18next';
import { isImageMime } from '@ai/agent-contracts';
import { ContextBubble } from '../../components/context-bubble';
import { showErrorToast } from '../../components/toast-store';
import { isCaptureContext } from '../../client/agent/screenshot-input';
import type { FileRef, RunSnapshot } from '../../client/agent/task-schema';
import { fileSize } from '../../lib/file-size';
import { ImageLightbox } from './image-lightbox';
import { agentApi } from './use-agent';

function fileDetail(file: FileRef): string {
  const size = fileSize(file.size);
  const dot = file.name.lastIndexOf('.');
  if (dot <= 0 || dot === file.name.length - 1) return size;
  return `${file.name.slice(dot + 1).toUpperCase()} · ${size}`;
}

/**
 * Files attached to a run, above its prompt bubble (User message pattern), once per run: queued
 * follow-ups carry none. Images show as thumbnails, each read only once it scrolls into view, that
 * open in a lightbox; other files as rows that show the file in Finder (the service's copy, which
 * the shell downloads, since an attachment keeps no source path). A capture's screen context is
 * left out beside its image, so a screenshot reads as one item as it did in the composer. Captured
 * selection or clipboard text is not previewed here: the bubble carries the resolved instruction,
 * which is where a command places that text.
 */
export function UserContext({ snapshot }: { snapshot: RunSnapshot }) {
  const { t } = useTranslation('tasks');
  const images = snapshot.input.files.filter((file) => isImageMime(file.type));
  const others = snapshot.input.files.filter(
    (file) => !isImageMime(file.type) && !(images.length > 0 && isCaptureContext(file)),
  );
  if (images.length + others.length === 0) return null;
  async function reveal(file: FileRef) {
    try {
      await agentApi().artifact(file.id, 'reveal');
    } catch (error) {
      showErrorToast(error);
    }
  }
  return (
    <ContextBubble.Root>
      {images.length > 0 && (
        <ContextBubble.Files className="flex-row flex-wrap">
          {images.map((file) => (
            <li key={file.id}>
              <ImageLightbox file={file} />
            </li>
          ))}
        </ContextBubble.Files>
      )}
      {others.length > 0 && (
        <ContextBubble.Files>
          {others.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                className="user-context-file"
                aria-label={t('files.showInFinder', { name: file.name })}
                onClick={() => void reveal(file)}
              >
                <span className="min-w-0 flex-1 truncate" title={file.name}>
                  {file.name}
                </span>
                {fileDetail(file)}
              </button>
            </li>
          ))}
        </ContextBubble.Files>
      )}
    </ContextBubble.Root>
  );
}
