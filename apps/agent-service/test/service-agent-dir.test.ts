import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';
import { startTestService } from './service-harness.ts';

/** pi-web-access's `getWebSearchConfigDir`, from a fresh load: the package caches it per load. */
async function webSearchConfigDir(): Promise<unknown> {
  const manifest = createRequire(import.meta.url).resolve('pi-web-access/package.json');
  const dir = await realpath(path.dirname(manifest));
  const jiti = createJiti(path.join(dir, 'package.json'), { moduleCache: false, fsCache: false });
  const utils: unknown = await jiti.import(pathToFileURL(path.join(dir, 'utils.ts')).href);
  const read =
    typeof utils === 'object' && utils !== null
      ? Reflect.get(utils, 'getWebSearchConfigDir')
      : undefined;
  assert.equal(typeof read, 'function');
  return Reflect.apply(read, undefined, []);
}

test('the service points Pi lookups and the DuckDuckGo cooldown at its own agent dir', async () => {
  // As in a fresh service process, whose environment names no agent dir.
  delete process.env['PI_CODING_AGENT_DIR'];
  const service = await startTestService();
  try {
    const { agentDir } = service.config.paths;
    // pi-subagents reads its config and agents here, pi-web-access its config and the cooldown
    // file every DuckDuckGo search shares; none of them may reach the user's own ~/.pi/agent.
    assert.equal(process.env['PI_CODING_AGENT_DIR'], agentDir);
    assert.equal(getAgentDir(), agentDir);
    assert.equal(await webSearchConfigDir(), agentDir);
  } finally {
    await service.stop();
  }
});
