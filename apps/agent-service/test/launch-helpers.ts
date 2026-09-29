import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import {
  ErrorEnvelopeSchema,
  McpLaunchApprovalDetailsSchema,
  McpLaunchApprovalRecordSchema,
  McpStatusResponseSchema,
  parse,
  type McpLaunchApprovalState,
} from '@ai/agent-contracts';
import { launchStoreFile } from '../dist/mcp/launch-store.js';
import type { startTestService } from './service-harness.ts';

type Harness = Awaited<ReturnType<typeof startTestService>>;

const StoreSchema = Type.Object({
  version: Type.Literal(1),
  approvals: Type.Array(McpLaunchApprovalRecordSchema),
  notice: Type.Boolean(),
});

/**
 * Launch approval test helpers. A launcher is a shell script that appends to its marker file
 * whenever it runs, so "nothing was spawned" is observed on disk rather than inferred.
 */
export async function launcher(dirs: string[]): Promise<{ command: string; marker: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'launch-script-'));
  dirs.push(dir);
  const marker = path.join(dir, 'spawned');
  const command = path.join(dir, 'server.sh');
  await writeFile(command, `#!/bin/sh\necho "$@" >> '${marker}'\nexit 1\n`);
  await chmod(command, 0o755);
  return { command, marker };
}

export const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

/** Waits up to `ms` for a launcher to have run. */
export async function spawnedWithin(marker: string, ms = 10000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await exists(marker)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export function client(harness: Harness) {
  const send = async (pathname: string, method: string, body?: unknown) => {
    const response = await harness.call(pathname, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) as unknown };
  };
  const status = async () =>
    parse(McpStatusResponseSchema, (await send('/v1/mcp/status', 'GET')).json);
  const approvalOf = async (serverId: string): Promise<McpLaunchApprovalState> => {
    const row = (await status()).servers.find((server) => server.serverId === serverId);
    assert.ok(row, `${serverId} has a status row`);
    return row.approval;
  };
  const details = async (serverId: string) => {
    const response = await send(`/v1/admin/approvals/mcp/${encodeURIComponent(serverId)}`, 'GET');
    assert.equal(response.status, 200, response.text);
    return { details: parse(McpLaunchApprovalDetailsSchema, response.json), text: response.text };
  };
  const approve = (serverId: string, fingerprint: string, via = 'shell') =>
    send('/v1/admin/approvals/mcp', 'POST', { serverId, fingerprint, via });
  /** Reads the current details and approves exactly them, as the shell would after its dialog. */
  const approveNow = async (serverId: string) => {
    const response = await approve(serverId, (await details(serverId)).details.fingerprint);
    assert.equal(response.status, 200, response.text);
  };
  const stored = async () =>
    parse(
      StoreSchema,
      JSON.parse(await readFile(launchStoreFile(harness.config.paths.root), 'utf8')),
    );
  return { send, status, approvalOf, details, approve, approveNow, stored };
}

export function errorCode(json: unknown): string {
  return parse(ErrorEnvelopeSchema, json).error.code;
}
