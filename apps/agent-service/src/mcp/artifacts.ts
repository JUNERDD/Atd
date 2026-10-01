import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { McpAttachment } from '@ai/agent-contracts';
import { MappingError, type MappingContext, type MappingDeps } from './errors.js';

/**
 * Artifact adoption: binary MCP payloads and temp files a tool result names
 * become resource-service artifacts. Remote-local paths never leak to
 * clients; non-tmp paths redact instead of being read.
 */

export const MAX_BLOB_BYTES = 8 * 1024 * 1024;

export async function materializeBlob(
  deps: MappingDeps,
  base64: string,
  mimeType: string,
  kind: string,
  ctx: MappingContext,
): Promise<McpAttachment> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw new MappingError(ctx, `a ${kind} payload is not valid base64.`);
  }
  if (bytes.length > MAX_BLOB_BYTES)
    throw new MappingError(ctx, `a ${kind} payload exceeds the 8 MiB limit.`);
  const name = `mcp-${kind}-${randomUUID().slice(0, 8)}${extensionFor(mimeType)}`;
  const resource = await deps.resources.save({
    name,
    mime: mimeType.slice(0, 100),
    bytes,
    ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
  });
  return {
    artifactId: resource.id,
    kind,
    mimeType,
    name,
    note: `${kind} saved to the resource service.`,
  };
}

export async function adoptTempPaths(
  deps: MappingDeps,
  text: string,
  ctx: MappingContext,
): Promise<{ text: string; attachments: McpAttachment[] }> {
  const roots = [tmpdir(), '/tmp'];
  const escapedRoots = roots.map((root) => root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `(${escapedRoots.map((root) => `${root}[^\\s"']+`).join('|')}|[A-Za-z]:\\\\[^\\s"']+|file://[^\\s"']+)`,
    'g',
  );
  const attachments: McpAttachment[] = [];
  let output = text;
  const candidates = [...new Set(text.match(pattern) ?? [])].slice(0, 10);
  for (const candidate of candidates) {
    const local = candidate.startsWith('file://') ? candidate.slice('file://'.length) : candidate;
    const inside = roots.some((root) =>
      path.resolve(local).startsWith(path.resolve(root) + path.sep),
    );
    if (!inside) {
      output = output.replaceAll(candidate, '[local-path-redacted]');
      continue;
    }
    try {
      const bytes = await readFile(local);
      if (bytes.length > MAX_BLOB_BYTES) {
        output = output.replaceAll(candidate, '[local-file-too-large]');
        continue;
      }
      const resource = await deps.resources.save({
        name: path.basename(local).slice(0, 255) || 'mcp-temp.bin',
        mime: 'application/octet-stream',
        bytes: new Uint8Array(bytes),
        ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
      });
      attachments.push({
        artifactId: resource.id,
        kind: 'temp-file',
        mimeType: null,
        name: resource.name,
        note: 'Temp output adopted into an artifact.',
      });
      output = output.replaceAll(candidate, `[artifact ${resource.id}]`);
    } catch {
      output = output.replaceAll(candidate, '[local-path-unreadable]');
    }
  }
  return { text: output, attachments };
}

function extensionFor(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.trim() || '';
  if (/^[a-z0-9]{1,10}$/i.test(subtype)) return `.${subtype.toLowerCase()}`;
  return '.bin';
}
