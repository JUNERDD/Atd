/**
 * Document types an artifact may open with no prompt. Main has no UTType API, so this is an explicit
 * allowlist: every other extension, including a missing one, asks first because some types run code
 * when opened on macOS (.command, .terminal, .jar, .webloc, .workflow, .scpt, .pkg, .dmg, ...).
 * Keep it to types whose default handlers display content; SVG and HTML open in a browser that runs
 * their scripts, and macro-enabled office formats (docm, xlsm, pptm) are left out on purpose.
 */
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  // Documents and plain text.
  'pdf',
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'log',
  'rtf',
  // Office and iWork.
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'pages',
  'numbers',
  'key',
  // Images.
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'heif',
  'tif',
  'tiff',
  'bmp',
  // Audio.
  'mp3',
  'm4a',
  'aac',
  'wav',
  'aif',
  'aiff',
  'flac',
  'caf',
  // Video.
  'mp4',
  'm4v',
  'mov',
]);

/**
 * Removes characters that could make the name misrepresent its type or escape the downloads folder:
 * path separators and reserved characters, control characters, and bidirectional formatting marks
 * (a right-to-left override can display `x.command` as a harmless-looking name). The result is the
 * on-disk name, so its extension is exactly the one Launch Services sees.
 */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[\p{Cc}/\\?%*:|"<>]/gu, '_')
      .replace(/\p{Bidi_Control}/gu, '')
      .slice(0, 200) || 'download.bin'
  );
}

/**
 * True when a file may open without asking. Only the final extension counts, case-insensitively,
 * so `report.pdf.command` is a `command` file.
 */
export function opensWithoutAsking(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return false;
  return DOCUMENT_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}
