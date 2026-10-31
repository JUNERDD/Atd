import { createHash } from 'node:crypto';
import path from 'node:path';
import { writeExtractedFile } from './output-write.js';

/** Distinct pictures one document saves; later ones keep their place in the text without a file. */
const MAX_IMAGES = 300;
/** Bytes of pictures one document saves. */
const MAX_IMAGE_BYTES = 192 * 1024 * 1024;
/** Sheets one workbook saves whole. */
const MAX_SHEETS = 500;
/** Characters of a sheet's name kept in its file name. */
const NAME_CHARS = 40;

/** A picture saved beside a document's text. */
export interface ExtractedImage {
  /** Its path in the entry, such as `images/03.png`. */
  file: string;
  mime: string;
  bytes: number;
  /** Its alternative text, or ''. */
  alt: string;
  /** Where the document shows it, such as `Slide 4`, in order of appearance. */
  where: string[];
}

/** A sheet saved whole beside a workbook's text. */
export interface ExtractedSheet {
  /** Its path in the entry, such as `sheets/02-Sales.csv`. */
  file: string;
  name: string;
  /** The cell range the CSV holds, such as `A1:O25001`; record N is the range's Nth row. */
  range: string;
  rows: number;
  columns: number;
  /** Whether the workbook hides the sheet. */
  hidden: boolean;
}

/**
 * The files an extraction wrote beside a document's text, for the entry's manifest. The text
 * refers to each by its path in the entry; what could not be saved is named in `omitted`.
 */
export interface ExtractedFiles {
  images: ExtractedImage[];
  sheets: ExtractedSheet[];
  omitted: string[];
}

/** Image types by their first bytes, with the extension their file gets. */
const SIGNATURES: readonly { mime: string; ext: string; test: (bytes: Uint8Array) => boolean }[] = [
  { mime: 'image/png', ext: 'png', test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47]) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/gif', ext: 'gif', test: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && ascii(b, 8, 4) === 'WEBP',
  },
  { mime: 'image/bmp', ext: 'bmp', test: (b) => starts(b, [0x42, 0x4d]) },
  {
    mime: 'image/tiff',
    ext: 'tiff',
    test: (b) => starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a]),
  },
  {
    mime: 'image/emf',
    ext: 'emf',
    test: (b) => starts(b, [0x01, 0, 0, 0]) && ascii(b, 40, 4) === ' EMF',
  },
  {
    mime: 'image/wmf',
    ext: 'wmf',
    test: (b) => starts(b, [0xd7, 0xcd, 0xc6, 0x9a]) || starts(b, [0x01, 0x00, 0x09, 0x00]),
  },
  { mime: 'image/svg+xml', ext: 'svg', test: (b) => /<svg[\s>]/i.test(ascii(b, 0, 512)) },
];

/**
 * Writes an extraction's files into `dir`, the staging directory the main thread made for it, and
 * keeps the summary its manifest records. Without `dir` (an extraction nothing is kept of) it
 * writes nothing and every request answers undefined, so extractors run the same either way.
 * Names come from the writer, never from the document: `images/NN.<ext>` by first appearance and
 * `sheets/NN-<name>.csv`, a sheet's name reduced to letters, digits, spaces, `.`, `-` and `_`.
 */
export class ExtractOutputs {
  private readonly images: ExtractedImage[] = [];
  private readonly byDigest = new Map<string, ExtractedImage>();
  private readonly sheets: ExtractedSheet[] = [];
  private readonly omitted = new Set<string>();
  private imageBytes = 0;

  constructor(private readonly dir?: string) {}

  /**
   * Saves a picture once per distinct content and notes where it appears; its path in the entry,
   * or undefined when nothing is kept or a limit was reached (the summary says which).
   */
  image(bytes: Uint8Array, alt: string, where: string): string | undefined {
    if (!this.dir) return undefined;
    const digest = createHash('sha256').update(bytes).digest('hex');
    const known = this.byDigest.get(digest);
    if (known) {
      if (!known.where.includes(where)) known.where.push(where);
      return known.file;
    }
    if (this.images.length >= MAX_IMAGES || this.imageBytes + bytes.byteLength > MAX_IMAGE_BYTES) {
      this.omitted.add(`Pictures past the first ${this.images.length} are not saved.`);
      return undefined;
    }
    const type = SIGNATURES.find(({ test }) => test(bytes));
    const file = `images/${pad(this.images.length + 1)}.${type?.ext ?? 'bin'}`;
    this.write(file, bytes);
    const image: ExtractedImage = {
      file,
      mime: type?.mime ?? 'application/octet-stream',
      bytes: bytes.byteLength,
      alt,
      where: [where],
    };
    this.images.push(image);
    this.byDigest.set(digest, image);
    this.imageBytes += bytes.byteLength;
    return file;
  }

  /**
   * Where sheet number `index` (from 1) named `name` is to be written: its path in the entry and on
   * disk, for the caller to write and then `addSheet`. Undefined when nothing is kept or past the
   * sheet limit.
   */
  sheetFile(index: number, name: string): { file: string; absolute: string } | undefined {
    if (!this.dir) return undefined;
    if (index > MAX_SHEETS) {
      this.omitted.add(`Sheets past the first ${MAX_SHEETS} are not saved whole.`);
      return undefined;
    }
    const safe = name
      .replace(/[^\p{L}\p{N} ._-]+/gu, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NAME_CHARS);
    const file = `sheets/${pad(index)}-${safe || 'Sheet'}.csv`;
    const absolute = path.join(this.dir, file);
    return { file, absolute };
  }

  /** Records a sheet written whole at `file`. */
  addSheet(sheet: ExtractedSheet): void {
    this.sheets.push(sheet);
  }

  /** Records something the files leave out, as one line of the manifest. */
  omit(note: string): void {
    this.omitted.add(note);
  }

  /** What was written, or undefined when nothing was. */
  summary(): ExtractedFiles | undefined {
    if (!this.images.length && !this.sheets.length && !this.omitted.size) return undefined;
    return { images: this.images, sheets: this.sheets, omitted: [...this.omitted] };
  }

  private write(file: string, bytes: Uint8Array): void {
    if (!this.dir) return;
    const absolute = path.join(this.dir, file);
    writeExtractedFile(absolute, bytes);
  }
}

/** `01`, `02`, … `100`: two digits at least, so a listing sorts in document order up to 99. */
function pad(number: number): string {
  return String(number).padStart(2, '0');
}

function starts(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/** `length` bytes from `offset` as Latin-1 text, for checking a signature. */
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
