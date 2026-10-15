import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareServe } from '../../../agent-service/dist/config.js';
import { createService } from '../../../agent-service/dist/index.js';
import { installMemoryKeyring } from '../../../agent-service/test/memory-keyring.ts';
import { afterRestart, beforeRestart, CORE_CASES } from './core-cases.mjs';
import { startModelFixture } from './model-fixture.mjs';
import { readEndpoint, serviceClient } from './service-client.mjs';

// Development-only harness validation: a source-built service and memory keyring.
// The release workflow never imports this file; it must use the bundled service and OS keychain.
await test('smoke cases match the real service contracts', { timeout: 180000 }, async (t) => {
  const previous = { home: process.env.AI_ATD_HOME, offline: process.env.PI_OFFLINE };
  const directory = await mkdtemp(path.join(tmpdir(), 'atd-smoke-contract-'));
  process.env.AI_ATD_HOME = path.join(directory, 'atd');
  process.env.PI_OFFLINE = '1';
  const keyring = installMemoryKeyring();
  const fixture = await startModelFixture();
  let service;
  t.after(async () => {
    await service?.stop();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
    if (previous.home === undefined) delete process.env.AI_ATD_HOME;
    else process.env.AI_ATD_HOME = previous.home;
    if (previous.offline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous.offline;
  });
  async function start() {
    const config = await prepareServe({ flagDir: directory, host: '127.0.0.1', port: 0 });
    service = await createService(config);
    await service.start();
    return serviceClient(await readEndpoint(directory));
  }
  const passed = [];
  const check = async (name, run) => {
    let failure;
    await t.test(name, async () => {
      try {
        await run();
      } catch (error) {
        failure = error;
        throw error;
      }
    });
    // Subtest failures otherwise allow later cases to run against an invalid state.
    if (failure) throw new Error(`Contract failed: ${name}`, { cause: failure });
    passed.push(name);
  };
  const state = { otherTasks: [] };
  const first = await start();
  await beforeRestart(first, fixture, check, state);
  await service.stop();
  assert.equal(await readEndpoint(directory), null);
  const second = await start();
  assert.equal(second.endpoint.serviceId, first.endpoint.serviceId);
  assert.ok(second.endpoint.epoch > first.endpoint.epoch);
  await afterRestart(second, fixture, check, state);
  assert.equal(keyring.accounts(second.endpoint.serviceId).size, 0);
  assert.deepEqual(passed, CORE_CASES);
});
