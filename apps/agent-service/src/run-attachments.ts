import { formatDimensionNote, resizeImage } from '@earendil-works/pi-coding-agent';
import { errorMessage, isImageMime, type FileRef } from '@atd/agent-contracts';
import type { Logger } from './logging.js';
import type { RunAttachment } from './pi-session.js';
import type { ResourceStore } from './resources.js';

/**
 * Reads a run's files as its material: an image (by the media type it was stored with) becomes
 * image input for the model, anything else is text read into the material. Each names its
 * resource's file, which the task's read tool opens without asking. A file that cannot be read is
 * skipped so the run still starts without it.
 */
export async function loadRunAttachments(
  resources: Pick<ResourceStore, 'readBytes' | 'pathOf'>,
  files: readonly FileRef[],
  log: Logger,
  taskId: string,
): Promise<RunAttachment[]> {
  const attachments: RunAttachment[] = [];
  for (const file of files) {
    try {
      const { resource, bytes } = await resources.readBytes(file.id);
      const { name } = file;
      const path = resources.pathOf(file.id);
      attachments.push(
        isImageMime(resource.mime)
          ? await imageAttachment(name, path, resource.mime, bytes)
          : { kind: 'text', name, path, text: Buffer.from(bytes).toString('utf8') },
      );
    } catch (error) {
      log.warn('Attachment unreadable; continuing without it.', {
        taskId,
        error: errorMessage(error),
      });
    }
  }
  return attachments;
}

/**
 * Fits the image to Pi's inline limits here, so the coordinate note for a scaled image goes into
 * the hidden run material instead of Pi appending it to the visible message. Pi still applies the
 * model's own limits to the prompt's images. When the image cannot be scaled it is passed as it
 * is, and Pi reports what it cannot send.
 */
async function imageAttachment(
  name: string,
  path: string,
  mime: string,
  bytes: Uint8Array,
): Promise<RunAttachment> {
  const resized = await resizeImage(bytes, mime);
  const note = resized ? formatDimensionNote(resized) : undefined;
  return {
    kind: 'image',
    name,
    path,
    image: resized
      ? { type: 'image', data: resized.data, mimeType: resized.mimeType }
      : { type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: mime },
    ...(note ? { note } : {}),
  };
}
