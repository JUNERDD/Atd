import type { McpAttachment, McpCallResult, McpContentBlock } from '@atd/agent-contracts';
import { toLlmContent, type LlmContent } from '@earendil-works/pi-mcp';
import { FULL_JSON_KIND, cutMiddle } from './text-limits.js';

/**
 * What the model reads of an MCP tool result, by pi-mcp's `toLlmContent` rules: text stays text,
 * images and embedded image resources become image blocks (pi-ai swaps them for a note on models
 * without vision), and audio, binary resources and resource links become short text. Every
 * artifact the result produced is named after the content, and the limits note closes it.
 */

/** JSON of a structured-only result, in the form `toLlmContent` gives the model. */
export function structuredJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * The model's content for `result`, in block order; adjacent text joins into one block. A result
 * with no content blocks but structured content reads as that content's JSON, cut in the middle
 * like any long text, its whole JSON in the `full-json` artifact mapping saved.
 */
export function toPiContent(
  result: McpCallResult,
  pathOf: (artifactId: string) => string,
): LlmContent[] {
  const content: LlmContent[] = [];
  const addText = (text: string) => {
    if (!text) return;
    const last = content.at(-1);
    if (last?.type === 'text') last.text = `${last.text}\n\n${text}`;
    else content.push({ type: 'text', text });
  };
  for (const block of result.content) {
    for (const item of blockContent(block)) {
      if (item.type === 'text') addText(item.text);
      else content.push(item);
    }
  }
  const structured = result.structuredContent ?? null;
  if (!result.content.length && structured !== null) {
    const full = result.attachments.find((attachment) => attachment.kind === FULL_JSON_KIND);
    addText(
      cutMiddle(structuredJson(structured), full?.artifactId ? pathOf(full.artifactId) : null),
    );
  }
  for (const attachment of result.attachments) addText(attachmentLine(attachment, pathOf));
  if (result.limitsNote) addText(`(limits: ${result.limitsNote})`);
  if (!result.isError) return content.length ? content : [{ type: 'text', text: '' }];
  // Pi marks the call failed (`isError`); the text says so to the model as well.
  const prefix = 'MCP tool reported an error:';
  const first = content[0];
  if (first?.type === 'text') first.text = `${prefix}\n${first.text}`;
  else content.unshift({ type: 'text', text: prefix });
  return content;
}

/**
 * One block as `toLlmContent` maps it, except a resource link, which says that the app never
 * fetches it (D6), and an embedded resource that carries neither text nor a blob.
 */
function blockContent(block: McpContentBlock): LlmContent[] {
  switch (block.type) {
    case 'resource_link':
      return [{ type: 'text', text: `[link ${block.name}: ${block.uri}] (not fetched)` }];
    case 'resource': {
      const { uri, text, blob, mimeType } = block.resource;
      const typed = mimeType === undefined ? {} : { mimeType };
      if (text !== undefined)
        return toLlmContent({ content: [{ type: 'resource', resource: { uri, text, ...typed } }] });
      if (blob !== undefined)
        return toLlmContent({ content: [{ type: 'resource', resource: { uri, blob, ...typed } }] });
      return [{ type: 'text', text: `[resource ${uri}]` }];
    }
    case 'text':
    case 'image':
    case 'audio':
      return toLlmContent({ content: [block] });
  }
}

/** Where an attachment went: its artifact, or the note that says why there is none. */
function attachmentLine(attachment: McpAttachment, pathOf: (artifactId: string) => string): string {
  if (!attachment.artifactId) return `[${attachment.kind}: ${attachment.note}]`;
  const type = attachment.mimeType ? ` ${attachment.mimeType}` : '';
  return `[${attachment.kind}${type} saved at ${pathOf(attachment.artifactId)}]`;
}
