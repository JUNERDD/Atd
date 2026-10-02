import { MAX_BLOB_BYTES, adoptTempPaths, materializeBlob } from './artifacts.js';
import { MappingError, type MappingContext, type MappingDeps } from './errors.js';
import { structuredJson } from './model-content.js';
import {
  FULL_JSON_KIND,
  FULL_TEXT_KIND,
  exceedsInlineLimit,
  limitText,
  type LimitedText,
} from './text-limits.js';
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
 * a result names are adopted into artifacts (never leaked); long text keeps its
 * start and end, its whole text saved as an artifact (text-limits.ts);
 * resource links are never implicitly downloaded or executed; prompt output
 * becomes previewable input, never a system instruction. What the model reads
 * of a result is model-content.ts.
 */

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
      // Paths are adopted (or redacted) in the whole text, so the saved whole text leaks none.
      const adopted = await adoptTempPaths(deps, narrowed.text, ctx);
      attachments.push(...adopted.attachments);
      if (adopted.attachments.length) notes.push('local temp paths were adopted into artifacts');
      const limited = await limitText(deps, adopted.text, ctx, FULL_TEXT_KIND, 'text/plain');
      content.push({ type: 'text', text: limited.text });
      keepLimit(limited, attachments, notes);
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
      const { blob, text } = narrowed.resource;
      let resource = narrowed.resource;
      if (text !== undefined) {
        const limited = await limitText(deps, text, ctx, FULL_TEXT_KIND, 'text/plain');
        resource = { ...resource, text: limited.text };
        keepLimit(limited, attachments, notes);
      }
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
      content.push({ type: 'resource', resource });
      continue;
    }
    // resource_link: a typed reference only; never fetched or executed here.
    content.push(narrowed);
  }
  // Kept whole for API consumers. The model reads it only when the result has no content blocks
  // (model-content.ts `toPiContent`), as its JSON cut like any long text; the whole JSON is then
  // kept the same way.
  const structuredContent = record['structuredContent'];
  if (structuredContent !== undefined && structuredContent !== null) {
    const size = jsonSize(structuredContent);
    if (size > MAX_STRUCTURED_BYTES) notes.push(`structured content is large (${size} bytes)`);
    const json = content.length ? '' : structuredJson(structuredContent);
    if (exceedsInlineLimit(json)) {
      const limited = await limitText(deps, json, ctx, FULL_JSON_KIND, 'application/json');
      keepLimit(limited, attachments, notes);
    }
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

/** Records what limiting one text kept: its whole-text artifact and the note on it. */
function keepLimit(limited: LimitedText, attachments: McpAttachment[], notes: string[]): void {
  if (limited.attachment) attachments.push(limited.attachment);
  if (limited.note) notes.push(limited.note);
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
