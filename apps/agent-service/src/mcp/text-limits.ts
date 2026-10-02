import { randomUUID } from 'node:crypto';
import { errorMessage, type McpAttachment } from '@ai/agent-contracts';
import { MAX_BLOB_BYTES } from './artifacts.js';
import type { MappingContext, MappingDeps } from './errors.js';

/**
 * Long MCP text, cut like Codex and pi cut tool output: the start and the end stay, the middle
 * gives way to a marker. Nothing is lost: the whole text is saved to the resource service first,
 * and the marker gives that artifact's file, which the task's read tool opens without asking.
 */

/** Bytes of one text a result keeps inline, head and tail together. */
export const MAX_INLINE_TEXT_BYTES = 50 * 1024;

/** Attachment kind of the whole text of a block that was cut. */
export const FULL_TEXT_KIND = 'full-text';
/** Attachment kind of the whole JSON of a structured-only result that was cut for the model. */
export const FULL_JSON_KIND = 'full-json';

/** One text after the limit; `attachment` holds the whole text when it was cut and saved. */
export interface LimitedText {
  text: string;
  attachment: McpAttachment | null;
  note: string | null;
}

export function exceedsInlineLimit(text: string): boolean {
  return Buffer.byteLength(text) > MAX_INLINE_TEXT_BYTES;
}

/**
 * `text` as a result keeps it: unchanged within the limit, else cut in the middle, with the whole
 * text saved as an artifact of `kind` that the marker names. A text that cannot be saved is still
 * cut; the marker and the note say it was not kept.
 */
export async function limitText(
  deps: MappingDeps,
  text: string,
  ctx: MappingContext,
  kind: string,
  mimeType: string,
): Promise<LimitedText> {
  if (!exceedsInlineLimit(text)) return { text, attachment: null, note: null };
  const saved = await keepFullText(deps, text, ctx, kind, mimeType);
  const attachment = typeof saved === 'string' ? null : saved;
  const kept =
    typeof saved === 'string'
      ? `not kept: ${saved}`
      : `saved whole as artifact ${saved.artifactId}`;
  const lines = text.split('\n').length;
  const half = MAX_INLINE_TEXT_BYTES / 2 / 1024;
  return {
    text: cutMiddle(
      text,
      attachment?.artifactId ? deps.resources.pathOf(attachment.artifactId) : null,
    ),
    attachment,
    note: `a ${lines}-line text was cut to its first and last ${half} KB (${kept})`,
  };
}

/**
 * The start and end of `text`, half of `MAX_INLINE_TEXT_BYTES` each, around a marker naming the
 * file with the whole text (`fullTextPath`, null when it was not kept). Cuts only at character
 * boundaries, as pi's `truncateMiddle` does; text within the limit is returned unchanged.
 */
export function cutMiddle(text: string, fullTextPath: string | null): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= MAX_INLINE_TEXT_BYTES) return text;
  // Continuation bytes (10xxxxxx) do not start a character.
  const starts = (index: number) => index >= bytes.length || ((bytes[index] ?? 0) & 0xc0) !== 0x80;
  let headEnd = Math.floor(MAX_INLINE_TEXT_BYTES / 2);
  while (headEnd > 0 && !starts(headEnd)) headEnd -= 1;
  let tailStart = bytes.length - (MAX_INLINE_TEXT_BYTES - Math.floor(MAX_INLINE_TEXT_BYTES / 2));
  while (tailStart < bytes.length && !starts(tailStart)) tailStart += 1;
  const removed = Array.from(bytes.subarray(headEnd, tailStart).toString('utf8')).length;
  const where = fullTextPath
    ? `full text: ${fullTextPath} (read with offset/limit)`
    : 'full text not kept';
  return `${bytes.subarray(0, headEnd).toString('utf8')}…[${removed} chars truncated; ${where}]…${bytes.subarray(tailStart).toString('utf8')}`;
}

/** The whole text as an artifact, or why it could not be kept. */
async function keepFullText(
  deps: MappingDeps,
  text: string,
  ctx: MappingContext,
  kind: string,
  mimeType: string,
): Promise<McpAttachment | string> {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > MAX_BLOB_BYTES) return 'it exceeds the 8 MiB artifact limit';
  const name = `mcp-${kind}-${randomUUID().slice(0, 8)}${mimeType === 'application/json' ? '.json' : '.txt'}`;
  try {
    const resource = await deps.resources.save({
      name,
      mime: mimeType,
      bytes,
      ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
    });
    return {
      artifactId: resource.id,
      kind,
      mimeType,
      name,
      note: 'The whole text of a result that was cut for length.',
    };
  } catch (error) {
    deps.log.warn('MCP result text could not be saved whole.', {
      serverId: ctx.serverId,
      ...(ctx.tool ? { tool: ctx.tool } : {}),
      error: errorMessage(error),
    });
    return 'the artifact could not be saved';
  }
}
