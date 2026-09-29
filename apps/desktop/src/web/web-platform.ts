import { downloadResource } from '@ai/agent-client';
import {
  ATTACHABLE_EXTENSIONS,
  attachableExtension,
  attachableMime,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
} from '@ai/agent-contracts';
import type { AgentPlatform } from '../../electron/agent/agent-requests';
import { uploadAttachables, type AttachableUpload } from '../../electron/agent/attachable-upload';
import type { PreparedCommand } from '../../electron/agent/bridge';

/**
 * Opens the browser's file chooser. It must start inside the click that asked for it, so the
 * bridge call reaches this synchronously; a dismissed chooser resolves with no files.
 */
function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ATTACHABLE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/** The same checks the desktop applies to a picked path, on a browser `File`. */
async function readUpload(file: File): Promise<AttachableUpload> {
  const extension = attachableExtension(file.name);
  if (!extension) throw new Error(`${file.name} is not supported.`);
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new Error(`${file.name} must be a text file smaller than 1 MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, mime: attachableMime(extension), bytes };
}

/** Browser stand-ins for what the desktop does natively; the rest say where to find it. */
export function webPlatform(launch: (prepared: PreparedCommand, autoRun: boolean) => void) {
  const platform: AgentPlatform = {
    async chooseFiles(http) {
      const files = await pickFiles();
      if (files.length > MAX_ATTACHMENTS)
        throw new Error(`Attach at most ${MAX_ATTACHMENTS} files.`);
      // Every file is checked before the first upload, so a rejected one leaves no partial set.
      const uploads = await Promise.all(files.map(readUpload));
      return uploadAttachables(http, uploads);
    },
    copy: (text) => navigator.clipboard.writeText(text),
    async openLink(url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    async artifact(options, artifactId, operation) {
      if (operation === 'reveal' || operation === 'locate' || operation === 'copy')
        throw new Error('Showing files on disk needs the desktop app.');
      const downloaded = await downloadResource(options, artifactId);
      const file = {
        id: artifactId,
        name: downloaded.name,
        size: downloaded.bytes.length,
        type: downloaded.mime,
      };
      if (operation === 'open') {
        const bytes = new Uint8Array(downloaded.bytes);
        const url = URL.createObjectURL(new Blob([bytes], { type: downloaded.mime }));
        const link = document.createElement('a');
        link.href = url;
        link.download = downloaded.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      return file;
    },
    launch,
  };
  return platform;
}
