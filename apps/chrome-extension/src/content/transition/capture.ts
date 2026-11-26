import type { BackgroundToContent, ContentMessage } from '../../messages/content.ts';

/** The background's answer to a capture request. */
export type FrameReply = Extract<BackgroundToContent, { type: 'transition.frame' }>;

/** How long a capture may take before its transition gives up and draws nothing. */
const CAPTURE_TIMEOUT_MS = 400;

interface Pending {
  id: string;
  timer: number;
  settle(jpeg: string | null): void;
}

/**
 * Asks the service worker for the tab's visible area (`transition.capture`) and decodes the JPEG
 * it answers with (`transition.frame`). The image is decoded from its bytes (base64 → Blob →
 * `createImageBitmap`), never fetched as a `data:` URL, so the page's CSP cannot refuse it. One
 * request is in flight at a time; a newer one, `cancel`, or the timeout settle the older with
 * nothing, and a late answer to it is dropped.
 */
export class CaptureClient {
  private pending: Pending | null = null;

  constructor(private readonly send: (message: ContentMessage) => void) {}

  /**
   * The tab as the frame for transition `id`, flipped so its first row is the bottom one (GL's
   * orientation); null when it could not be had in time. `hold` holds the agent's screenshots
   * and input to the tab until `transition.end` (the takeover).
   */
  async capture(id: string, hold: boolean): Promise<ImageBitmap | null> {
    this.cancel();
    const jpeg = await new Promise<string | null>((resolve) => {
      const pending: Pending = {
        id,
        timer: window.setTimeout(() => this.settle(id, null), CAPTURE_TIMEOUT_MS),
        settle: resolve,
      };
      this.pending = pending;
      this.send({ type: 'transition.capture', requestId: id, hold });
    });
    return jpeg === null ? null : decode(jpeg);
  }

  /** The background's `transition.frame`. */
  receive(reply: FrameReply): void {
    this.settle(reply.requestId, reply.jpeg);
  }

  /** Settles the request in flight, if any, with nothing. */
  cancel(): void {
    if (this.pending) this.settle(this.pending.id, null);
  }

  private settle(id: string, jpeg: string | null): void {
    const pending = this.pending;
    if (pending?.id !== id) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.settle(jpeg);
  }
}

async function decode(base64: string): Promise<ImageBitmap | null> {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    // WebGL ignores UNPACK_FLIP_Y for an ImageBitmap, so the bitmap is flipped as it is decoded.
    return await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
    });
  } catch {
    return null;
  }
}
