import { fileFormat, UNKNOWN_FILE_MIME } from '@atd/agent-contracts';

/** How the loader names a file: a human label and the media type it reports. */
export interface Format {
  label: string;
  mime: string;
}

/**
 * Labels of the formats the loader detects or a name suggests, keyed by a lower-case
 * extension-like id (sniff.ts). Any other id reads `<EXT> file`; no id at all, `Binary file`.
 */
const LABELS: Readonly<Record<string, string>> = {
  pdf: 'PDF document',
  doc: 'Word document',
  dot: 'Word document',
  docx: 'Word document',
  docm: 'Word document',
  wordml: 'Word XML document',
  rtf: 'RTF document',
  odt: 'OpenDocument text',
  ods: 'OpenDocument spreadsheet',
  odp: 'OpenDocument presentation',
  odg: 'OpenDocument drawing',
  pages: 'Pages document',
  numbers: 'Numbers document',
  key: 'Keynote document',
  epub: 'EPUB book',
  xls: 'Excel workbook',
  xlsx: 'Excel workbook',
  xlsm: 'Excel workbook',
  xlsb: 'Excel workbook',
  ppt: 'PowerPoint presentation',
  pptx: 'PowerPoint presentation',
  pptm: 'PowerPoint presentation',
  office: 'Office document',
  ole: 'Office document',
  msg: 'Outlook message',
  sqlite: 'SQLite database',
  sqlite3: 'SQLite database',
  db: 'SQLite database',
  zip: 'Zip archive',
  jar: 'Java archive',
  apk: 'Android package',
  gz: 'Gzip archive',
  tgz: 'Gzip archive',
  bz2: 'Bzip2 archive',
  xz: 'XZ archive',
  zst: 'Zstandard archive',
  '7z': '7-Zip archive',
  rar: 'RAR archive',
  tar: 'Tar archive',
  dmg: 'Disk image',
  pkg: 'Installer package',
  plist: 'Property list',
  png: 'PNG image',
  jpg: 'JPEG image',
  jpeg: 'JPEG image',
  gif: 'GIF image',
  webp: 'WebP image',
  bmp: 'BMP image',
  tif: 'TIFF image',
  tiff: 'TIFF image',
  heic: 'HEIC image',
  heif: 'HEIF image',
  avif: 'AVIF image',
  ico: 'Icon image',
  mp3: 'MP3 audio',
  m4a: 'MPEG-4 audio',
  aac: 'AAC audio',
  wav: 'WAV audio',
  flac: 'FLAC audio',
  ogg: 'Ogg audio',
  oga: 'Ogg audio',
  opus: 'Opus audio',
  aif: 'AIFF audio',
  aiff: 'AIFF audio',
  caf: 'Core Audio file',
  mid: 'MIDI file',
  midi: 'MIDI file',
  mp4: 'MP4 video',
  m4v: 'MPEG-4 video',
  mov: 'QuickTime movie',
  avi: 'AVI video',
  mkv: 'Matroska video',
  webm: 'WebM video',
  mpg: 'MPEG video',
  mpeg: 'MPEG video',
  '3gp': '3GP video',
  macho: 'Mach-O executable',
  elf: 'ELF executable',
  exe: 'Windows executable',
  wasm: 'WebAssembly module',
  class: 'Java class file',
};

/** Media types of detected formats the attachment format table does not list. */
const MIMES: Readonly<Record<string, string>> = {
  dot: 'application/msword',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  wordml: 'application/xml',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  odg: 'application/vnd.oasis.opendocument.graphics',
  office: 'application/x-ole-storage',
  ole: 'application/x-ole-storage',
  msg: 'application/vnd.ms-outlook',
  jar: 'application/java-archive',
  apk: 'application/vnd.android.package-archive',
  pkg: 'application/x-xar',
  macho: 'application/x-mach-binary',
  elf: 'application/x-executable',
  exe: 'application/vnd.microsoft.portable-executable',
  wasm: 'application/wasm',
  class: 'application/java-vm',
};

/** The label and media type of format `id`. */
export function formatOf(id: string): Format {
  return {
    label: LABELS[id] ?? (id ? `${id.toUpperCase()} file` : 'Binary file'),
    mime: fileFormat(`file.${id}`)?.mime ?? MIMES[id] ?? UNKNOWN_FILE_MIME,
  };
}

/** The lower-case extension of a file name or path, or '' when it has none worth trusting. */
export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return /^[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

/** Extensions for stored media types that settle what an extensionless name leaves open. */
const MIME_HINTS: Readonly<Record<string, string>> = {
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.apple.pages': 'pages',
  'application/vnd.apple.numbers': 'numbers',
  'application/vnd.apple.keynote': 'key',
};

/**
 * What a file's name, else its stored media type, suggests it is. The content decides first
 * (sniff.ts); the hint settles what the content leaves open, such as which Office program an OLE2
 * file belongs to, and names a file the loader shows only as a description.
 */
export function formatHint(name?: string, mime?: string): string {
  return extensionOf(name ?? '') || (mime === undefined ? '' : (MIME_HINTS[mime] ?? ''));
}
