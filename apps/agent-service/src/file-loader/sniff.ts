import { readsAsUtf8Text } from './text.js';
import { listZip, smallEntry, type ZipListing } from './zip.js';

/** How the loader turns a file into model input (loader.ts). */
export type Route =
  /** Decoded as text, or described when its bytes turn out binary. */
  | 'text'
  /** Image input as it is: PNG, JPEG, GIF, WebP, and BMP, which Pi converts itself. */
  | 'image'
  /** Image input after a conversion to JPEG: HEIC, HEIF, TIFF and AVIF. */
  | 'convert'
  /** Extracted in a worker (extract.ts). */
  | 'pdf'
  | 'docx'
  | 'sheet'
  | 'pptx'
  | 'odp'
  | 'epub'
  /** Word 97–2003, RTF, OpenDocument text and Word XML, converted by macOS textutil. */
  | 'textutil'
  /** Pages, Keynote and PowerPoint 97–2003: the plain text macOS Spotlight reads from them. */
  | 'spotlight'
  /** An encrypted Office file. */
  | 'protected'
  /** A zip, described with its entries. */
  | 'archive'
  /** Any other binary format, described. */
  | 'binary';

/** The input formats textutil is forced to read, so it never treats a file as HTML. */
export type TextutilFormat = 'doc' | 'rtf' | 'odt' | 'wordml';

/**
 * A file's format by its content: `id` keys formats.ts, '' when nothing names the format. A PDF
 * is `prefixed` when bytes precede its `%PDF-` (a text in a legacy encoding that merely mentions it
 * looks the same).
 */
export type Detected =
  | { id: string; route: 'textutil'; format: TextutilFormat; zip?: ZipListing }
  | { id: string; route: 'pdf'; prefixed: boolean }
  | { id: string; route: Exclude<Route, 'textutil' | 'pdf'>; zip?: ZipListing };

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Fixed signatures of binary formats the loader only describes: id, offset, bytes. Each is long or
 * non-ASCII enough that no text file starts with it.
 */
const SIGNATURES: readonly (readonly [string, number, string | readonly number[]])[] = [
  ['sqlite', 0, 'SQLite format 3\0'],
  ['gz', 0, [0x1f, 0x8b, 0x08]],
  ['xz', 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]],
  ['zst', 0, [0x28, 0xb5, 0x2f, 0xfd]],
  ['7z', 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  ['rar', 0, 'Rar!\x1a\x07'],
  ['elf', 0, '\x7fELF'],
  ['macho', 0, [0xfe, 0xed, 0xfa, 0xce]],
  ['macho', 0, [0xfe, 0xed, 0xfa, 0xcf]],
  ['macho', 0, [0xce, 0xfa, 0xed, 0xfe]],
  ['macho', 0, [0xcf, 0xfa, 0xed, 0xfe]],
  ['wasm', 0, '\0asm'],
  ['plist', 0, 'bplist00'],
  ['pkg', 0, 'xar!\0\x1c'],
  ['flac', 0, 'fLaC\0'],
  ['ogg', 0, 'OggS\0'],
  ['mid', 0, 'MThd\0\0\0\x06'],
  ['caf', 0, 'caff\0\x01'],
  ['mkv', 0, [0x1a, 0x45, 0xdf, 0xa3]],
];

/** OLE2 files by the program their extension names. */
const OLE_HINTS: Readonly<Record<string, 'doc' | 'xls' | 'ppt' | 'msg'>> = {
  doc: 'doc',
  dot: 'doc',
  xls: 'xls',
  xlt: 'xls',
  xla: 'xls',
  ppt: 'ppt',
  pps: 'ppt',
  pot: 'ppt',
  msg: 'msg',
};

/** Office extensions an encrypted OLE2 container may carry. */
const OFFICE_IDS = new Set(['doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'xlsb', 'ppt', 'pptx']);

/** OpenDocument and EPUB media types (a `mimetype` entry), templates included by prefix. */
const ZIP_MIME_TYPES: readonly (readonly [string, Exclude<Detected, { route: 'pdf' }>])[] = [
  ['application/vnd.oasis.opendocument.text', { id: 'odt', route: 'textutil', format: 'odt' }],
  ['application/vnd.oasis.opendocument.spreadsheet', { id: 'ods', route: 'sheet' }],
  ['application/vnd.oasis.opendocument.presentation', { id: 'odp', route: 'odp' }],
  ['application/vnd.oasis.opendocument.graphics', { id: 'odg', route: 'archive' }],
  ['application/epub+zip', { id: 'epub', route: 'epub' }],
];

/** Zip-family document ids a zip that matched none of them must not be labeled with. */
const ZIP_DOCUMENTS = new Set([
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'epub',
  'pages',
  'key',
]);

/**
 * A file's format by its content, the same for an attachment and for `read`. `hint` (formats.ts
 * `formatHint`) settles only what content leaves open: which program an OLE2 file belongs to, and
 * the label of a file that matches no signature.
 */
export function detect(bytes: Uint8Array, hint: string): Detected {
  if (ascii(bytes, 0, '%PDF-')) return { id: 'pdf', route: 'pdf', prefixed: false };
  if (ascii(bytes, 0, 'PK\x03\x04') || ascii(bytes, 0, 'PK\x05\x06')) return zipFamily(bytes, hint);
  if (startsWith(bytes, OLE2)) return oleFamily(bytes, hint);
  if (ascii(bytes, 0, '{\\rtf')) return { id: 'rtf', route: 'textutil', format: 'rtf' };
  const signed = imageFormat(bytes) ?? binaryFormat(bytes);
  if (signed) return signed;
  // pdf.js finds a header within the first KB; a format signed at offset 0 never gets here. A
  // text that only mentions it there (PDF tooling, a fixture) reads as UTF-8, which a PDF does not.
  if (latin1(bytes, 1024).includes('%PDF-') && !readsAsUtf8Text(bytes))
    return { id: 'pdf', route: 'pdf', prefixed: true };
  return textFormat(bytes, hint);
}

function zipFamily(bytes: Uint8Array, hint: string): Detected {
  const zip = listZip(bytes);
  if (!zip) return { id: hint || 'zip', route: 'binary' };
  const names = zip.entries.map((entry) => entry.name);
  const has = (prefix: string) => names.some((name) => name.startsWith(prefix));
  if (names.includes('[Content_Types].xml')) {
    if (has('word/')) return { id: 'docx', route: 'docx', zip };
    if (has('xl/')) {
      const binary = names.includes('xl/workbook.bin');
      return { id: binary ? 'xlsb' : hint === 'xlsm' ? 'xlsm' : 'xlsx', route: 'sheet', zip };
    }
    if (has('ppt/')) return { id: 'pptx', route: 'pptx', zip };
  }
  if (names.includes('mimetype')) {
    const raw = smallEntry(bytes, 'mimetype', 256);
    const type = raw ? new TextDecoder().decode(raw).trim() : '';
    const match = ZIP_MIME_TYPES.find(([mime]) => type === mime || type.startsWith(`${mime}-`));
    if (match) return { ...match[1], zip };
  }
  if (names.includes('Index/Document.iwa')) {
    // iWork apps by the parts they write: slides for Keynote, table tiles for Numbers. A Pages
    // document with a table can look like Numbers; the loader falls back to Spotlight for it.
    if (names.some((name) => /^Index\/(Template|Master)?Slide/.test(name)))
      return { id: 'key', route: 'spotlight', zip };
    if (has('Index/Tables/')) return { id: 'numbers', route: 'sheet', zip };
    return { id: 'pages', route: 'spotlight', zip };
  }
  return { id: hint && !ZIP_DOCUMENTS.has(hint) ? hint : 'zip', route: 'archive', zip };
}

function oleFamily(bytes: Uint8Array, hint: string): Detected {
  // Encrypted .docx, .xlsx and .pptx files are OLE2 containers holding these two streams.
  if (hasStream(bytes, 'EncryptionInfo') && hasStream(bytes, 'EncryptedPackage'))
    return { id: OFFICE_IDS.has(hint) ? hint : 'office', route: 'protected' };
  const id = OLE_HINTS[hint] ?? oleProgram(bytes);
  if (id === 'doc') return { id, route: 'textutil', format: 'doc' };
  if (id === 'xls') return { id, route: 'sheet' };
  if (id === 'ppt') return { id, route: 'spotlight' };
  return { id, route: 'binary' };
}

/** An OLE2 file's program by the streams its directory names (UTF-16LE, NUL-terminated). */
function oleProgram(bytes: Uint8Array): 'doc' | 'xls' | 'ppt' | 'msg' | 'ole' {
  if (hasStream(bytes, 'WordDocument')) return 'doc';
  if (hasStream(bytes, 'PowerPoint Document')) return 'ppt';
  if (hasStream(bytes, 'Workbook') || hasStream(bytes, 'Book')) return 'xls';
  // Outlook stores each message property in a stream named `__substg1.0_<tag>`.
  if (containsUtf16(bytes, '__substg1.0_')) return 'msg';
  return 'ole';
}

function hasStream(bytes: Uint8Array, name: string): boolean {
  return containsUtf16(bytes, `${name}\0`);
}

function containsUtf16(bytes: Uint8Array, text: string): boolean {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.includes(Buffer.from(text, 'utf16le'));
}

function imageFormat(bytes: Uint8Array): Detected | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { id: 'png', route: 'image' };
  // JPEG-LS (FF D8 FF F7) is a different codec that no image model or Pi decodes.
  if (startsWith(bytes, [0xff, 0xd8, 0xff]) && bytes[3] !== 0xf7)
    return { id: 'jpeg', route: 'image' };
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return { id: 'gif', route: 'image' };
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return { id: 'webp', route: 'image' };
  if (ascii(bytes, 0, 'BM') && isBmp(bytes)) return { id: 'bmp', route: 'image' };
  if (ascii(bytes, 0, 'II*\0') || ascii(bytes, 0, 'MM\0*')) return { id: 'tiff', route: 'convert' };
  // An `ftyp` box first, with a plausible box size (text there would read as a huge one).
  if (ascii(bytes, 4, 'ftyp') && u32be(bytes, 0) >= 8 && u32be(bytes, 0) <= 4096)
    return isoMedia(bytes);
  if (startsWith(bytes, [0, 0, 1, 0]) && (bytes[4] ?? 0) > 0 && bytes[5] === 0)
    return { id: 'ico', route: 'binary' };
  return undefined;
}

/** A BMP header's DIB header size and color planes, as Pi's own BMP check reads them. */
function isBmp(bytes: Uint8Array): boolean {
  const dib = u32le(bytes, 14);
  if (dib === 12) return u16le(bytes, 22) === 1;
  return dib >= 40 && dib <= 124 && u16le(bytes, 26) === 1;
}

/** An ISO base media file (`ftyp` box) by its brands: HEIF and AVIF images, or MP4-family media. */
function isoMedia(bytes: Uint8Array): Detected {
  const major = latin1(bytes.subarray(8), 4);
  const end = Math.min(u32be(bytes, 0), 64, bytes.length);
  const brands: string[] = [];
  for (let offset = 16; offset + 4 <= end; offset += 4)
    brands.push(latin1(bytes.subarray(offset), 4));
  const heic = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'];
  if (major === 'avif' || major === 'avis') return { id: 'avif', route: 'convert' };
  if (heic.includes(major)) return { id: 'heic', route: 'convert' };
  if (major === 'mif1' || major === 'msf1') {
    if (brands.includes('avif')) return { id: 'avif', route: 'convert' };
    return { id: brands.some((brand) => heic.includes(brand)) ? 'heic' : 'heif', route: 'convert' };
  }
  if (major === 'qt  ') return { id: 'mov', route: 'binary' };
  if (major.startsWith('M4A')) return { id: 'm4a', route: 'binary' };
  if (major.startsWith('M4V')) return { id: 'm4v', route: 'binary' };
  if (major.startsWith('3g')) return { id: '3gp', route: 'binary' };
  return { id: 'mp4', route: 'binary' };
}

function binaryFormat(bytes: Uint8Array): Detected | undefined {
  for (const [id, offset, signature] of SIGNATURES) {
    const matches =
      typeof signature === 'string'
        ? ascii(bytes, offset, signature)
        : startsWith(bytes, signature, offset);
    if (!matches) continue;
    return {
      id: id === 'mkv' && latin1(bytes, 64).includes('webm') ? 'webm' : id,
      route: 'binary',
    };
  }
  const id = containerFormat(bytes) ?? executableFormat(bytes) ?? audioFormat(bytes);
  return id ? { id, route: 'binary' } : undefined;
}

/** RIFF and IFF media, tar and bzip2, whose first bytes alone could also start a text. */
function containerFormat(bytes: Uint8Array): string | undefined {
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'wav';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'AVI ')) return 'avi';
  if (ascii(bytes, 0, 'FORM') && (ascii(bytes, 8, 'AIFF') || ascii(bytes, 8, 'AIFC')))
    return 'aiff';
  // A POSIX tar header: `ustar` at 257 in a NUL-padded 512-byte block.
  if (
    ascii(bytes, 257, 'ustar') &&
    [0, 0x20].includes(bytes[262] ?? -1) &&
    bytes.subarray(0, 512).includes(0)
  )
    return 'tar';
  // `BZh`, a block size digit, then a block or end-of-stream magic.
  const bzip2 =
    ascii(bytes, 4, '1AY&SY') || startsWith(bytes, [0x17, 0x72, 0x45, 0x38, 0x50, 0x90], 4);
  return ascii(bytes, 0, 'BZh') && bzip2 ? 'bz2' : undefined;
}

function executableFormat(bytes: Uint8Array): string | undefined {
  // CAFEBABE opens both universal Mach-O binaries (a small architecture count) and Java classes.
  if (startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe])) return u32be(bytes, 4) < 64 ? 'macho' : 'class';
  if (ascii(bytes, 0, 'MZ') && ascii(bytes, u32le(bytes, 60), 'PE\0\0')) return 'exe';
  return undefined;
}

/** MP3 by its ID3 tag (versions 2.2–2.4) or the first bytes of a typical MPEG audio frame. */
function audioFormat(bytes: Uint8Array): string | undefined {
  if (ascii(bytes, 0, 'ID3') && [2, 3, 4].includes(bytes[3] ?? 0)) return 'mp3';
  if (bytes[0] === 0xff && [0xfb, 0xfa, 0xf3, 0xf2, 0xe3, 0xe2].includes(bytes[1] ?? 0))
    return 'mp3';
  return undefined;
}

/** Word 2003 XML goes to textutil; any other markup, HTML included, stays text. */
function textFormat(bytes: Uint8Array, hint: string): Detected {
  const head = latin1(bytes, 4096)
    .replace(/^ï»¿/, '')
    .trimStart();
  if (
    head.startsWith('<?xml') &&
    (head.includes('progid="Word.Document"') || head.includes('<w:wordDocument'))
  )
    return { id: 'wordml', route: 'textutil', format: 'wordml' };
  return { id: hint, route: 'text' };
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte)
  );
}

function ascii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (offset < 0 || bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1)
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  return true;
}

function latin1(bytes: Uint8Array, length: number): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(length, bytes.byteLength)).toString(
    'latin1',
  );
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (u16le(bytes, offset) | (u16le(bytes, offset + 2) << 16)) >>> 0;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}
