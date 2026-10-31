import { counted } from './document.js';
import type { ExtractOutputs } from './outputs.js';
import { detect } from './sniff.js';
import type { ZipMediaBudget } from './zip.js';

/** Slide media inflation matches the writer's byte limit; Word uses a smaller copy budget. */
const MEDIA_BYTES = 192 * 1024 * 1024;
const VIEWABLE_TYPES = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
]);

/** Image occurrences, their saved files and truthful placeholders shared by Word and slides. */
export class Pictures {
  count = 0;

  constructor(
    private readonly outputs: ExtractOutputs,
    readonly saving: boolean,
  ) {}

  budget(wanted: ZipMediaBudget['wanted'], totalBytes = MEDIA_BYTES): ZipMediaBudget | undefined {
    if (!this.saving) return undefined;
    return {
      wanted,
      totalBytes,
      omitted: () =>
        this.outputs.omit(
          `Some images exceed the ${totalBytes / (1024 * 1024)} MiB media allowance and are not saved.`,
        ),
    };
  }

  /** Missing or excluded bytes keep a placeholder; output paths always come from the writer. */
  place(bytes: Uint8Array | undefined, alt: string, where: string, format = ''): string {
    this.count += 1;
    const text = alt.replace(/\s+/g, ' ').trim();
    const file = bytes ? this.outputs.image(bytes, text, where) : undefined;
    if (!bytes && this.saving)
      this.outputs.omit(
        'Some images are external, missing or excluded by the media allowance and are not saved.',
      );
    const type = (file?.split('.').at(-1) ?? format)
      .toLowerCase()
      .replace(/^.*\//, '')
      .replace(/^x-/, '');
    const detected = bytes ? detect(bytes.subarray(0, 4096), '') : undefined;
    const viewable = detected
      ? detected.route === 'image' || detected.route === 'convert'
      : VIEWABLE_TYPES.has(type);
    const unsupported =
      viewable || (!bytes && !type)
        ? ''
        : `; ${['emf', 'wmf', 'svg', 'svg+xml'].includes(type) ? type.replace('+xml', '').toUpperCase() : 'this format'} cannot be viewed as an image`;
    return `[Image${text ? `: ${text}` : ''}${file ? ` — ${file}` : ''}${unsupported}]`;
  }

  get included(): string {
    const saved = this.outputs.summary()?.images.length ?? 0;
    return saved
      ? `images have placeholders with paths to ${counted(saved, 'saved image file')}`
      : 'images have placeholders; no image files are saved';
  }
}
