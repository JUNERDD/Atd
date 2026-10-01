import { MAX_BLOB_BYTES, adoptTempPaths, materializeBlob } from './artifacts.js';
import { MappingError, type MappingContext, type MappingDeps } from './errors.js';
import type {
  McpAttachment,
  McpCallResult,
  McpContentBlock,
  McpGetPromptResponse,
  McpPromptMessage,
  McpReadResourceResponse,
} from '@ai/agent-contracts';

/**
 * Result mapping (D6): tool results keep their original MCP blocks for API
 * consumers; images/files become resource-service artifacts; temp file paths
 * a result names are adopted into artifacts (never leaked); resource links are
 * never implicitly downloaded or executed; prompt output becomes previewable
 * input, never a system instruction.
 */

const MAX_INLINE_TEXT_BYTES = 50 * 1024;
const MAX_INLINE_TEXT_LINES = 2000;
const MAX_STRUCTURED_BYTES = 16 * 1024;

/** Narrows a raw CallToolResult into the typed service result. */
export async function mapCallResult(
  deps: MappingDeps,
  raw: unknown,
  ctx: MappingContext,
): Promise<McpCallResult> {
  const record = isRecord(raw);
  if (!record) throw new MappingError(ctx, 'the result is not an object.');
  const rawBlocks = Array.isArray(record['content']) ? record['content'] : null;
  if (!rawBlocks) throw new MappingError(ctx, 'the result has no content array.');
  const content: McpContentBlock[] = [];
  const attachments: McpAttachment[] = [];
  const notes: string[] = [];
  for (const [index, entry] of rawBlocks.entries()) {
    const narrowed = narrowContentBlock(entry);
    if (!narrowed) {
      attachments.push({
        artifactId: null,
        kind: 'unsupported',
        mimeType: null,
        name: null,
        note: `Content block ${index} has an unsupported type and was kept as an attachment note.`,
      });
      notes.push(`block ${index}: unsupported media type`);
      continue;
    }
    if (narrowed.type === 'text') {
      const { text, note } = enforceTextLimits(narrowed.text);
      content.push({ type: 'text', text });
      if (note) notes.push(note);
      const adopted = await adoptTempPaths(deps, text, ctx);
      attachments.push(...adopted.attachments);
      if (adopted.attachments.length) {
        content[content.length - 1] = { type: 'text', text: adopted.text };
        notes.push('local temp paths were adopted into artifacts');
      }
      continue;
    }
    if (narrowed.type === 'image' || narrowed.type === 'audio') {
      const artifact = await materializeBlob(
        deps,
        narrowed.data,
        narrowed.mimeType,
        narrowed.type,
        ctx,
      );
      attachments.push(artifact);
      content.push(narrowed);
      continue;
    }
    if (narrowed.type === 'resource') {
      const blob = narrowed.resource.blob;
      if (blob) {
        const artifact = await materializeBlob(
          deps,
          blob,
          narrowed.resource.mimeType ?? 'application/octet-stream',
          'resource',
          ctx,
        );
        attachments.push({ ...artifact, name: narrowed.resource.uri.slice(0, 256) });
      }
      content.push(narrowed);
      continue;
    }
    // resource_link: a typed reference only; never fetched or executed here.
    content.push(narrowed);
  }
  // Kept whole for API consumers. The model reads it only when the result has nothing else
  // (`toPiText`).
  const structuredContent = record['structuredContent'];
  if (structuredContent !== undefined) {
    const size = jsonSize(structuredContent);
    if (size > MAX_STRUCTURED_BYTES) notes.push(`structured content is large (${size} bytes)`);
  }
  return {
    content,
    structuredContent: structuredContent ?? null,
    isError: record['isError'] === true,
    attachments,
    limitsNote: notes.join('; ').slice(0, 2000),
  };
}

/** Narrows a raw ReadResourceResult; blobs stay typed, never auto-fetched. */
export function mapReadResource(
  raw: unknown,
  ctx: MappingContext & { uri: string },
): McpReadResourceResponse {
  const record = isRecord(raw);
  const contents = record && Array.isArray(record['contents']) ? record['contents'] : null;
  if (!contents) throw new MappingError(ctx, 'the resource result has no contents array.');
  return {
    serverId: ctx.serverId,
    uri: ctx.uri,
    contents: contents.map((entry) => {
      const item = isRecord(entry);
      if (!item || typeof item['uri'] !== 'string')
        throw new MappingError(ctx, 'a resource content is malformed.');
      const blob = typeof item['blob'] === 'string' ? item['blob'] : undefined;
      if (blob && Buffer.byteLength(blob, 'base64') > MAX_BLOB_BYTES) {
        throw new MappingError(ctx, 'a resource blob exceeds the 8 MiB limit.');
      }
      return {
        uri: item['uri'],
        ...(typeof item['text'] === 'string' ? { text: item['text'] } : {}),
        ...(blob ? { blob } : {}),
        ...(typeof item['mimeType'] === 'string' ? { mimeType: item['mimeType'] } : {}),
      };
    }),
  };
}

/** Narrows a raw GetPromptResult; messages keep roles and original blocks. */
export function mapGetPrompt(
  raw: unknown,
  ctx: MappingContext & { name: string },
): McpGetPromptResponse {
  const record = isRecord(raw);
  const messages = record && Array.isArray(record['messages']) ? record['messages'] : null;
  if (!messages) throw new MappingError(ctx, 'the prompt result has no messages array.');
  const narrowed: McpPromptMessage[] = messages.map((entry) => {
    const item = isRecord(entry);
    const role = item?.['role'];
    const block = item ? narrowContentBlock(item['content']) : null;
    if ((role !== 'user' && role !== 'assistant') || !block) {
      throw new MappingError(ctx, 'a prompt message is malformed.');
    }
    return { role, content: block };
  });
  const description = record?.['description'];
  return {
    serverId: ctx.serverId,
    name: ctx.name,
    description: typeof description === 'string' ? description : null,
    messages: narrowed,
  };
}

/**
 * Renders a prompt result as quotable INPUT for user preview. The output is
 * submitted as user input after approval, never installed as a system prompt.
 */
export function promptPreviewToInput(response: McpGetPromptResponse): string {
  return response.messages
    .map((message) => {
      const body = blockToText(message.content);
      return `[${message.role}]\n${body}`;
    })
    .join('\n\n')
    .slice(0, 20000);
}

/** Transcript form: text plus artifact references; binaries stay in storage. */
export function toPiText(result: McpCallResult): string {
  const parts: string[] = [];
  const notes = result.limitsNote ? [result.limitsNote] : [];
  for (const block of result.content) parts.push(blockToText(block));
  for (const attachment of result.attachments) {
    if (attachment.artifactId) {
      parts.push(
        `[${attachment.kind}${attachment.mimeType ? ` ${attachment.mimeType}` : ''} saved as artifact ${attachment.artifactId}]`,
      );
    } else {
      parts.push(`[${attachment.kind}: ${attachment.note}]`);
    }
  }
  // A server may answer in `structuredContent` alone, and the model would read an empty result.
  // Like pi-mcp's `toLlmContent`, it then gets that data as JSON, clipped like any text.
  const structured = result.structuredContent ?? null;
  if (!parts.length && structured !== null) {
    const json = enforceTextLimits(JSON.stringify(structured, null, 2));
    parts.push(json.text);
    if (json.note) notes.push(json.note);
  }
  if (notes.length) parts.push(`(limits: ${notes.join('; ')})`);
  const text = parts.filter(Boolean).join('\n\n');
  return result.isError ? `MCP tool reported an error:\n${text}` : text;
}

function blockToText(block: McpContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'image':
      return `[image: ${block.mimeType}]`;
    case 'audio':
      return `[audio: ${block.mimeType}]`;
    case 'resource':
      return block.resource.text ?? `[resource ${block.resource.uri}]`;
    case 'resource_link':
      return `[link ${block.name}: ${block.uri}] (not fetched)`;
  }
}

function narrowContentBlock(value: unknown): McpContentBlock | null {
  const record = isRecord(value);
  if (!record || typeof record['type'] !== 'string') return null;
  switch (record['type']) {
    case 'text':
      return typeof record['text'] === 'string' ? { type: 'text', text: record['text'] } : null;
    case 'image':
    case 'audio':
      return typeof record['data'] === 'string' && typeof record['mimeType'] === 'string'
        ? { type: record['type'], data: record['data'], mimeType: record['mimeType'] }
        : null;
    case 'resource': {
      const resource = isRecord(record['resource']);
      if (!resource || typeof resource['uri'] !== 'string') return null;
      return {
        type: 'resource',
        resource: {
          uri: resource['uri'],
          ...(typeof resource['text'] === 'string' ? { text: resource['text'] } : {}),
          ...(typeof resource['blob'] === 'string' ? { blob: resource['blob'] } : {}),
          ...(typeof resource['mimeType'] === 'string' ? { mimeType: resource['mimeType'] } : {}),
        },
      };
    }
    case 'resource_link':
      return typeof record['uri'] === 'string' && typeof record['name'] === 'string'
        ? {
            type: 'resource_link',
            uri: record['uri'],
            name: record['name'],
            ...(typeof record['description'] === 'string'
              ? { description: record['description'] }
              : {}),
            ...(typeof record['mimeType'] === 'string' ? { mimeType: record['mimeType'] } : {}),
          }
        : null;
    default:
      return null;
  }
}

function enforceTextLimits(text: string): { text: string; note: string | null } {
  const bytes = Buffer.byteLength(text);
  const lines = text.split('\n').length;
  if (bytes <= MAX_INLINE_TEXT_BYTES && lines <= MAX_INLINE_TEXT_LINES) return { text, note: null };
  let clipped = text;
  if (lines > MAX_INLINE_TEXT_LINES)
    clipped = clipped.split('\n').slice(0, MAX_INLINE_TEXT_LINES).join('\n');
  while (Buffer.byteLength(clipped) > MAX_INLINE_TEXT_BYTES)
    clipped = clipped.slice(0, Math.floor(clipped.length * 0.9));
  return {
    text: `${clipped}\n…[truncated]`,
    note: `text clipped to ${MAX_INLINE_TEXT_BYTES} bytes / ${MAX_INLINE_TEXT_LINES} lines`,
  };
}

function jsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function isRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
