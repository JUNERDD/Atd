import { randomBytes } from 'node:crypto';
import { relationshipId, type Relationship } from './ooxml.js';
import type { Pictures } from './pictures.js';
import { descendants, type XmlElement } from './xml.js';
import { unzipBounded } from './zip.js';

interface SlidePicture {
  marker: string;
  part: string | undefined;
  alt: string;
  where: string;
}

/** Collect only pictures visited in a slide's chosen branches, then inflate their media once. */
export class SlidePictures {
  private readonly nonce = randomBytes(6).toString('hex');
  private readonly images: SlidePicture[] = [];

  constructor(private readonly pictures: Pictures) {}

  mark(picture: XmlElement, related: ReadonlyMap<string, Relationship>, where: string): string {
    const properties = descendants(picture, 'cNvPr')[0];
    const alt =
      properties?.getAttribute('descr')?.trim() || properties?.getAttribute('title') || '';
    const blip = descendants(picture, 'blip')[0];
    const target = blip ? related.get(relationshipId(blip, 'embed'))?.target : undefined;
    const part = target?.startsWith('ppt/media/') ? target : undefined;
    const marker = `ATDIMAGE${this.nonce}N${this.images.length + 1}Z`;
    this.images.push({ marker, part, alt, where });
    return marker;
  }

  place(bytes: Uint8Array): ReadonlyMap<string, string> {
    const wanted = new Set(this.images.flatMap(({ part }) => (part ? [part] : [])));
    const media = this.pictures.saving
      ? unzipBounded(
          bytes,
          () => false,
          this.pictures.budget(({ name }) => wanted.has(name)),
        )
      : {};
    return new Map(
      this.images.map(({ marker, part, alt, where }) => [
        marker,
        this.pictures.place(part ? media[part] : undefined, alt, where, part?.split('.').at(-1)),
      ]),
    );
  }
}
