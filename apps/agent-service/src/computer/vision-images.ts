import type { Api, ImageContent, Model, TextContent } from '@earendil-works/pi-ai';
import { resizeImage } from '@earendil-works/pi-coding-agent';
import { COMPUTER_MAX_VISUAL_SOURCES, type VisualSource } from '@atd/agent-contracts';
import { messageImages } from '../message-images.js';
import { visualSourceFacts } from './screen-state.js';

/** Maximum new encoded monitor image bytes per inference; provider limits also count history. */
export const SCREEN_IMAGE_BYTES = 4 * 1024 * 1024;
const ENVELOPE_RESERVE = 64 * 1024;

export interface VisionFrames {
  content: (TextContent | ImageContent)[];
  facts: (ReturnType<typeof visualSourceFacts> & { image: 'included' | 'not_supplied' })[];
  imageCount: number;
}

function existingImages(messages: readonly unknown[]) {
  return messages.reduce<number>((count, message) => count + messageImages(message).length, 0);
}

/**
 * Adds only transient monitor images. Existing task images are never removed or rewritten.
 * The main-request byte allowance is conservative: provider-specific serialization happens
 * later. The auxiliary request additionally checks its exact payload in `onPayload`.
 */
export async function prepareVisionFrames(
  sources: readonly VisualSource[],
  model: Model<Api>,
  messages: readonly unknown[],
  signal: AbortSignal | undefined,
): Promise<VisionFrames> {
  const limits = model.inputLimits;
  const existing = existingImages(messages);
  const perMessage = limits?.images?.maxPerMessage ?? Number.POSITIVE_INFINITY;
  // Providers may merge adjacent input/tool messages; reserve their existing images as well.
  let remaining = Math.max(
    0,
    Math.min(
      COMPUTER_MAX_VISUAL_SOURCES,
      perMessage - existing,
      (limits?.images?.maxPerRequest ?? Number.POSITIVE_INFINITY) - existing,
    ),
  );
  const sourceFacts = sources.map(visualSourceFacts);
  const knownBytes =
    limits?.maxRequestBytes === undefined
      ? 0
      : Buffer.byteLength(JSON.stringify(messages)) +
        Buffer.byteLength(JSON.stringify(sourceFacts));
  let bytes = Math.max(
    0,
    Math.min(
      SCREEN_IMAGE_BYTES,
      (limits?.maxRequestBytes ?? Number.POSITIVE_INFINITY) -
        Math.ceil(knownBytes * 1.25) -
        ENVELOPE_RESERVE,
    ),
  );
  const content: VisionFrames['content'] = [];
  const facts: VisionFrames['facts'] = [];
  let imageCount = 0;
  let framesLeft = sources.filter((source) => source.state === 'frame').length;
  for (const source of sources) {
    signal?.throwIfAborted();
    const sourceFact = visualSourceFacts(source);
    if (source.state !== 'frame') {
      facts.push({ ...sourceFact, image: 'not_supplied' });
      content.push({ type: 'text', text: JSON.stringify(sourceFact) });
      continue;
    }
    let image: ImageContent | undefined;
    const profile = limits?.images?.resize;
    const slots = Math.max(1, Math.min(remaining, framesLeft));
    const maxBytes = Math.floor(Math.min(bytes / slots, profile?.maxBytes ?? 1_398_104));
    framesLeft -= 1;
    const maxWidth = Math.min(1280, profile?.maxWidth ?? 1280);
    const maxHeight = Math.min(1280, profile?.maxHeight ?? 1280);
    if (remaining > 0 && maxBytes > 0) {
      if (
        source.width <= maxWidth &&
        source.height <= maxHeight &&
        source.base64.length <= maxBytes
      )
        image = { type: 'image', data: source.base64, mimeType: source.mime };
      else {
        const resized = await resizeImage(Buffer.from(source.base64, 'base64'), source.mime, {
          ...profile,
          maxWidth,
          maxHeight,
          maxBytes,
        });
        signal?.throwIfAborted();
        if (
          resized &&
          resized.data.length <= maxBytes &&
          resized.width <= maxWidth &&
          resized.height <= maxHeight
        )
          image = { type: 'image', data: resized.data, mimeType: resized.mimeType };
      }
    }
    content.push({
      type: 'text',
      text: JSON.stringify({
        ...sourceFact,
        image: image ? 'included_next' : 'omitted_image_budget',
      }),
    });
    facts.push({ ...sourceFact, image: image ? 'included' : 'not_supplied' });
    if (image) {
      content.push(image);
      imageCount += 1;
      remaining -= 1;
      bytes -= Buffer.byteLength(image.data);
    }
  }
  return { content, facts, imageCount };
}

/** A supported provider hook, used only on the independent, tool-free visual request. */
export function enforceVisionPayloadBudget(payload: unknown, model: Model<Api>): void {
  const limit = Math.min(
    model.inputLimits?.maxRequestBytes ?? Number.POSITIVE_INFINITY,
    SCREEN_IMAGE_BYTES + ENVELOPE_RESERVE,
  );
  const serialized = JSON.stringify(payload);
  if (serialized === undefined || Buffer.byteLength(serialized) > limit)
    throw new Error('The visual model request exceeds its image or request byte budget.');
}
