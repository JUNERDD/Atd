/**
 * Pixels an image may have to be passed on as image input. Scaling decodes the whole image at four
 * bytes a pixel, so a small file declaring a huge canvas (a decompression bomb) would take
 * gigabytes; camera photos and panoramas stay well below this.
 */
export const MAX_IMAGE_PIXELS = 100_000_000;

/** Bytes read for an image's header: a JPEG's frame header follows its metadata segments. */
export const IMAGE_HEADER_BYTES = 256 * 1024;

interface Dimensions {
  width: number;
  height: number;
}

/**
 * Why an image is not passed on as image input: its header declares more than
 * `MAX_IMAGE_PIXELS`. Undefined when it may be, also when `head` does not hold its dimensions.
 * `id` is its format (sniff.ts); `head` its first `IMAGE_HEADER_BYTES`, so every caller decides the
 * same for the same file.
 */
export function oversizeNote(id: string, head: Uint8Array): string | undefined {
  const size = imageDimensions(id, head);
  if (!size || size.width * size.height <= MAX_IMAGE_PIXELS) return undefined;
  const sides = `${size.width.toLocaleString('en-US')} × ${size.height.toLocaleString('en-US')}`;
  return `At ${sides} pixels it is larger than the ${MAX_IMAGE_PIXELS / 1_000_000} megapixels an image may have to be shown.`;
}

function imageDimensions(id: string, head: Uint8Array): Dimensions | undefined {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const has = (end: number) => end <= head.byteLength;
  switch (id) {
    case 'png':
      // The IHDR chunk comes first, right after the signature.
      if (!has(24) || ascii(head, 12, 4) !== 'IHDR') return undefined;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    case 'gif':
      if (!has(10)) return undefined;
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    case 'bmp':
      if (!has(26)) return undefined;
      if (view.getUint32(14, true) === 12)
        return { width: view.getUint16(18, true), height: view.getUint16(20, true) };
      // A negative height marks a top-down bitmap.
      return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
    case 'webp':
      return webpDimensions(head, view);
    case 'jpeg':
      return jpegDimensions(head, view);
    default:
      return undefined;
  }
}

/** A WebP's size from its first chunk: lossy (`VP8 `), lossless (`VP8L`) or extended (`VP8X`). */
function webpDimensions(head: Uint8Array, view: DataView): Dimensions | undefined {
  if (head.byteLength < 30) return undefined;
  const chunk = ascii(head, 12, 4);
  if (chunk === 'VP8 ')
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: uint24(head, 24) + 1, height: uint24(head, 27) + 1 };
  return undefined;
}

/** Start-of-frame markers: every one but DHT (C4), JPG (C8) and DAC (CC). */
const FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** A JPEG's size from its frame header, found by walking the segments before it. */
function jpegDimensions(head: Uint8Array, view: DataView): Dimensions | undefined {
  let offset = 2;
  while (offset + 9 <= head.byteLength) {
    if (head[offset] !== 0xff) return undefined;
    const marker = head[offset + 1] ?? 0;
    if (marker === 0xff) {
      // A fill byte before the marker.
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      // A marker without a length.
      offset += 2;
      continue;
    }
    if (FRAME_MARKERS.has(marker))
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    // Image data or the end of the image before any frame header.
    if (marker === 0xda || marker === 0xd9) return undefined;
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint24(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}
