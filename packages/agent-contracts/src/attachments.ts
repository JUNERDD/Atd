/**
 * Attachment rules every client and the service apply before a file becomes a resource: which
 * text formats the service reads back as run material, how many files one message takes, and how
 * large each may be. The service reads paths from disk (`/v1/resources/import`, file search
 * attach); the desktop reads picked paths; the web client reads browser `File`s.
 */

/**
 * Text formats the service reads back as UTF-8 run material. The single list every reader
 * mirrors, including the native file index.
 */
export const ATTACHABLE_EXTENSIONS = [
  'txt',
  'md',
  'csv',
  'json',
  'log',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'ts',
  'tsx',
  'js',
  'py',
] as const;
export type AttachableExtension = (typeof ATTACHABLE_EXTENSIONS)[number];

/** Files per message; `InputSchema.files` accepts the same number. */
export const MAX_ATTACHMENTS = 10;
/** Largest file read for one attachment, well under the service's 8 MiB resource cap. */
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;

/** The attachable format of a file name or path, by its last extension. */
export function attachableExtension(name: string): AttachableExtension | undefined {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const extension = base.slice(dot + 1).toLowerCase();
  return ATTACHABLE_EXTENSIONS.find((candidate) => candidate === extension);
}

/** The media type an attachment is stored with. */
export function attachableMime(extension: AttachableExtension): string {
  return extension === 'json' ? 'application/json' : 'text/plain';
}
