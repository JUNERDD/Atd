import type { ImageContent } from '@earendil-works/pi-ai';

/** Whether a content part is an inline image, the part every provider request serializes. */
export function isImageContent(value: unknown): value is ImageContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'image' &&
    'data' in value &&
    typeof value.data === 'string' &&
    'mimeType' in value &&
    typeof value.mimeType === 'string'
  );
}

/** The inline images of one model-context message, in order; string content has none. */
export function messageImages(message: unknown): ImageContent[] {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('content' in message) ||
    !Array.isArray(message.content)
  )
    return [];
  const content: unknown[] = message.content;
  return content.filter(isImageContent);
}

/** What an image adds to a request body: its base64 text, sent as it is by every provider. */
export function imageBytes(image: ImageContent): number {
  return image.data.length;
}
