import { parentPort } from 'node:worker_threads';

/**
 * What a page worker is sent: a tall image, its size as planned, its pages' pixel rows and the
 * edge each page is scaled within.
 */
export interface PagesRequest {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** `[top, bottom)` of each page, top to bottom. */
  rows: Array<[number, number]>;
  edge: number;
}

/** Its one answer: each page as a PNG, null when the image is not the size planned, or why not. */
export type PagesReply = { pages: Uint8Array[] | null } | { error: string };

/**
 * Entry of one page worker (attachment-pages.ts): it receives one tall image, answers once with
 * each page as a PNG scaled within `edge` on both sides, and is then terminated. Decoding,
 * cropping, scaling and encoding a long image take seconds, which would stall every other run on
 * the service's thread; scaling here, with the filter Pi's scaling uses (Lanczos3), also leaves
 * Pi only the byte budget to apply to each page.
 */
async function cut(request: PagesRequest): Promise<Uint8Array[] | null> {
  // Photon (Rust compiled to WebAssembly, Apache-2.0) is the image library Pi already ships for
  // its own scaling, which cannot crop; Pi does not export its loader (utils/photon), so this
  // loads the same package. Like Pi's, the load is deferred: the module is compiled only in a
  // worker that cuts pages.
  const { PhotonImage, SamplingFilter, crop, resize } = await import('@silvia-odwyer/photon-node');
  const image = PhotonImage.new_from_byteslice(request.bytes);
  try {
    const width = image.get_width();
    // A JPEG whose EXIF orientation turns it decodes here unturned: its rows would not be the
    // pages planned on the turned size, so it is read whole instead.
    if (width !== request.width || image.get_height() !== request.height) return null;
    return request.rows.map(([top, bottom]) => {
      const page = crop(image, 0, top, width, bottom);
      const scale = Math.min(1, request.edge / width, request.edge / (bottom - top));
      if (scale === 1) {
        try {
          return page.get_bytes();
        } finally {
          page.free();
        }
      }
      const fitted = resize(
        page,
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round((bottom - top) * scale)),
        SamplingFilter.Lanczos3,
      );
      page.free();
      try {
        return fitted.get_bytes();
      } finally {
        fitted.free();
      }
    });
  } finally {
    image.free();
  }
}

const port = parentPort;
if (!port) throw new Error('The attachment page worker runs only as a worker thread.');
port.once('message', (request: PagesRequest) => {
  void (async () => {
    let reply: PagesReply;
    try {
      reply = { pages: await cut(request) };
    } catch (error) {
      reply = { error: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(reply);
  })();
});
