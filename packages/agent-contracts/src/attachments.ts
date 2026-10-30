/**
 * Attachment rules every client and the service apply before a file becomes a resource. Every
 * regular file is attachable, up to `MAX_ATTACHMENT_BYTES` each and `MAX_ATTACHMENTS` per
 * message: the service turns what it can into model input (text, the text of documents, image
 * input) and describes any other file, so the agent can still talk about it and inspect it with its
 * tools (agent-service `file-loader/`). The format table below only says how a file is expected to
 * load, for icons, file search and the media type a resource is stored with; the service decides
 * from the file's content. The service reads paths from disk (`/v1/resources/import`, file search
 * attach); the desktop reads picked, dropped and pasted paths and screenshots.
 */

/** How clients show a known format and how file search groups it. */
export type FileKind =
  | 'text'
  | 'code'
  | 'data'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive';

/** A known format: its icon family and the media type a resource of it is stored with. */
export interface FileFormat {
  /** Lower case, without the dot. */
  extension: string;
  kind: FileKind;
  mime: string;
}

/** A family, the media type its files are stored with, and their space-separated extensions. */
type FormatGroup = readonly [kind: FileKind, mime: string, extensions: string];

const OOXML = 'application/vnd.openxmlformats-officedocument.';

/** Known formats. Code and text formats without a registered media type are `text/plain`. */
const FORMAT_GROUPS: readonly FormatGroup[] = [
  ['text', 'text/plain', 'txt text log rst adoc tex org nfo'],
  ['text', 'text/markdown', 'md markdown mdx mdc'],
  ['code', 'text/html', 'html htm xhtml'],
  ['code', 'text/css', 'css scss sass less'],
  ['code', 'text/javascript', 'js mjs cjs jsx'],
  [
    'code',
    'text/plain',
    'ts tsx mts cts vue svelte astro py pyi rb go rs java kt kts scala groovy',
  ],
  ['code', 'text/plain', 'gradle swift m mm c h cc cpp cxx hpp hh cs fs vb php pl pm lua r dart'],
  ['code', 'text/plain', 'ex exs erl hs clj elm zig nim jl sol asm s sql sh bash zsh fish ps1'],
  ['code', 'text/plain', 'bat cmd proto graphql gql tf hcl cmake mk diff patch'],
  ['code', 'text/plain', 'nix prisma glsl vert frag wgsl metal erb pbxproj'],
  ['data', 'text/csv', 'csv'],
  ['data', 'text/tab-separated-values', 'tsv'],
  ['data', 'application/json', 'json jsonc json5 jsonl ndjson geojson ipynb xcstrings'],
  ['data', 'application/xml', 'xml xsd xsl xslt rss atom'],
  ['data', 'application/yaml', 'yaml yml'],
  ['data', 'application/x-plist', 'plist entitlements'],
  ['data', 'text/calendar', 'ics'],
  ['data', 'text/vcard', 'vcf'],
  ['data', 'text/vtt', 'vtt'],
  ['data', 'application/x-subrip', 'srt'],
  ['data', 'application/vnd.sqlite3', 'sqlite sqlite3 db'],
  ['data', 'text/plain', 'toml ini cfg conf properties env lock'],
  ['document', 'application/pdf', 'pdf'],
  ['document', 'application/msword', 'doc'],
  ['document', `${OOXML}wordprocessingml.document`, 'docx'],
  ['document', 'application/rtf', 'rtf'],
  ['document', 'application/vnd.oasis.opendocument.text', 'odt'],
  ['document', 'application/vnd.apple.pages', 'pages'],
  ['document', 'application/epub+zip', 'epub'],
  ['spreadsheet', 'application/vnd.ms-excel', 'xls'],
  ['spreadsheet', `${OOXML}spreadsheetml.sheet`, 'xlsx'],
  ['spreadsheet', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'xlsm'],
  ['spreadsheet', 'application/vnd.oasis.opendocument.spreadsheet', 'ods'],
  ['spreadsheet', 'application/vnd.apple.numbers', 'numbers'],
  ['presentation', 'application/vnd.ms-powerpoint', 'ppt'],
  ['presentation', `${OOXML}presentationml.presentation`, 'pptx'],
  ['presentation', 'application/vnd.oasis.opendocument.presentation', 'odp'],
  ['presentation', 'application/vnd.apple.keynote', 'key'],
  ['image', 'image/png', 'png'],
  ['image', 'image/jpeg', 'jpg jpeg'],
  ['image', 'image/gif', 'gif'],
  ['image', 'image/webp', 'webp'],
  ['image', 'image/heic', 'heic'],
  ['image', 'image/heif', 'heif'],
  ['image', 'image/tiff', 'tif tiff'],
  ['image', 'image/bmp', 'bmp'],
  ['image', 'image/avif', 'avif'],
  ['image', 'image/svg+xml', 'svg'],
  ['image', 'image/x-icon', 'ico'],
  ['audio', 'audio/mpeg', 'mp3'],
  ['audio', 'audio/wav', 'wav'],
  ['audio', 'audio/mp4', 'm4a'],
  ['audio', 'audio/aac', 'aac'],
  ['audio', 'audio/flac', 'flac'],
  ['audio', 'audio/ogg', 'ogg oga'],
  ['audio', 'audio/opus', 'opus'],
  ['audio', 'audio/aiff', 'aif aiff'],
  ['audio', 'audio/x-caf', 'caf'],
  ['audio', 'audio/midi', 'mid midi'],
  ['video', 'video/mp4', 'mp4'],
  ['video', 'video/x-m4v', 'm4v'],
  ['video', 'video/quicktime', 'mov'],
  ['video', 'video/x-msvideo', 'avi'],
  ['video', 'video/x-matroska', 'mkv'],
  ['video', 'video/webm', 'webm'],
  ['video', 'video/mpeg', 'mpg mpeg'],
  ['video', 'video/3gpp', '3gp'],
  ['archive', 'application/zip', 'zip'],
  ['archive', 'application/x-tar', 'tar'],
  ['archive', 'application/gzip', 'gz tgz'],
  ['archive', 'application/x-bzip2', 'bz2'],
  ['archive', 'application/x-xz', 'xz'],
  ['archive', 'application/zstd', 'zst'],
  ['archive', 'application/x-7z-compressed', '7z'],
  ['archive', 'application/vnd.rar', 'rar'],
  ['archive', 'application/x-apple-diskimage', 'dmg'],
];

const FORMATS: ReadonlyMap<string, FileFormat> = new Map(
  FORMAT_GROUPS.flatMap(([kind, mime, extensions]) =>
    extensions
      .split(' ')
      .map((extension): [string, FileFormat] => [extension, { extension, kind, mime }]),
  ),
);

/**
 * The extensions file search lists, lower case and without the dot: every known format. The
 * service passes them to the native file index (`crates/file-index`), which keeps no copy.
 */
export const SEARCHABLE_EXTENSIONS: readonly string[] = [...FORMATS.keys()];

/**
 * Media types of images the model receives as image input. The service converts those models do
 * not take (HEIC, HEIF, TIFF, BMP, AVIF) to PNG or JPEG first; SVG loads as text and an icon file
 * as a described file, so neither is listed.
 */
const IMAGE_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
  'image/avif',
];

/** Media type of a file of no known format. */
export const UNKNOWN_FILE_MIME = 'application/octet-stream';

/** Files per message; `InputSchema.files` accepts the same number. */
export const MAX_ATTACHMENTS = 10;
/**
 * Largest file one attachment reads, of any format, and the service's resource cap. The service
 * loads at most a bounded part of a file into the model's context (agent-service `file-loader/`),
 * so the limit bounds storage and memory, not context. The desktop scales a screenshot down
 * before importing it.
 */
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

/** The known format of a file name or path, by its last extension; a leading dot alone is none. */
export function fileFormat(name: string): FileFormat | undefined {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return FORMATS.get(base.slice(dot + 1).toLowerCase());
}

/** The media type an attachment of this name is stored with. */
export function attachmentMime(name: string): string {
  return fileFormat(name)?.mime ?? UNKNOWN_FILE_MIME;
}

/** Whether a stored attachment's media type marks it as image input (see `IMAGE_MIME_TYPES`). */
export function isImageMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.includes(mime);
}
