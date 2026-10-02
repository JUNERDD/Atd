/**
 * Attachment rules every client and the service apply before a file becomes a resource: which
 * formats the service reads back as run material, how many files one message takes, and how
 * large each may be. The service reads paths from disk (`/v1/resources/import`, file search
 * attach); the desktop reads picked paths and screenshots; the web client reads browser `File`s.
 */

/** Text formats the service reads back as UTF-8 run material. */
export const ATTACHABLE_TEXT_EXTENSIONS = [
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

/**
 * Image formats the service sends to the model as image input with the message they belong to,
 * never as text. Their media types are `IMAGE_MIME_TYPES`.
 */
export const ATTACHABLE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

/** Every attachable format: the single list every reader mirrors, including the native file index. */
export const ATTACHABLE_EXTENSIONS = [
  ...ATTACHABLE_TEXT_EXTENSIONS,
  ...ATTACHABLE_IMAGE_EXTENSIONS,
] as const;
export type AttachableExtension = (typeof ATTACHABLE_EXTENSIONS)[number];
export type AttachableImageExtension = (typeof ATTACHABLE_IMAGE_EXTENSIONS)[number];

const IMAGE_MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const satisfies Record<AttachableImageExtension, string>;

/** Files per message; `InputSchema.files` accepts the same number. */
export const MAX_ATTACHMENTS = 10;
/** Largest text file read for one attachment, well under the service's 8 MiB resource cap. */
export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
/**
 * Largest image read for one attachment: the service's resource cap. The desktop scales a
 * screenshot down before importing it, so a capture stays within it.
 */
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** The attachable format of a file name or path, by its last extension. */
export function attachableExtension(name: string): AttachableExtension | undefined {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const extension = base.slice(dot + 1).toLowerCase();
  return ATTACHABLE_EXTENSIONS.find((candidate) => candidate === extension);
}

export function isImageExtension(
  extension: AttachableExtension,
): extension is AttachableImageExtension {
  return extension in IMAGE_MIME_TYPES;
}

/** Whether a stored attachment's media type marks it as image input. */
export function isImageMime(mime: string): boolean {
  return (Object.values(IMAGE_MIME_TYPES) as string[]).includes(mime);
}

/** The largest file of this format one attachment reads. */
export function attachmentByteLimit(extension: AttachableExtension): number {
  return isImageExtension(extension) ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
}

/** The media type an attachment is stored with. */
export function attachableMime(extension: AttachableExtension): string {
  if (isImageExtension(extension)) return IMAGE_MIME_TYPES[extension];
  return extension === 'json' ? 'application/json' : 'text/plain';
}
