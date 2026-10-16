import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ServiceConnection } from '@atd/agent-contracts';
import { ConnectionStore } from '../dist/credentials/connections.js';
import { KeyringBackend } from '../dist/credentials/keyring.js';
import { ConflictError, UpstreamError } from '../dist/errors.js';
import { inferenceError } from '../dist/providers/inference-result.js';
import { verifyModel } from '../dist/providers/runtime.js';

const modelId = 'deepseek-v4.1-flash';

async function fixture() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'provider-verification-'));
  const connections = await ConnectionStore.load(dataDir);
  const connection: ServiceConnection = {
    connectionId: 'test-verification',
    provider: 'opencode-go',
    name: 'Synthetic verification',
    baseUrl: '',
    authType: 'api_key',
    defaultModel: modelId,
    revision: 1,
    connected: true,
    hasCredential: false,
    configurationId: 'synthetic-configuration',
    verifiedModel: '',
    migratedAt: null,
  };
  await connections.change((data) => data.connections.push(connection));
  return {
    stores: { dataDir, connections, keyring: new KeyringBackend('test-verification') },
    connection,
  };
}

for (const stopReason of ['stop', 'length', 'error', 'aborted'] as const) {
  test(`model verification handles ${stopReason} without treating truncation as failure`, async (t) => {
    const { stores, connection } = await fixture();
    t.after(() => rm(stores.dataDir, { recursive: true, force: true }));
    t.mock.method(globalThis, 'fetch', () => {
      throw new Error('This regression test must not access the network.');
    });
    t.mock.method(stores.keyring, 'get', () => {
      throw new Error('This regression test must not access the OS keyring.');
    });
    const result = fauxAssistantMessage(
      stopReason === 'length' ? [{ type: 'thinking', thinking: 'Checking access.' }] : 'OK',
      { stopReason },
    );
    const complete = t.mock.method(ModelRuntime.prototype, 'completeSimple', async () => result);
    if (stopReason === 'error' || stopReason === 'aborted') {
      await assert.rejects(verifyModel(stores, connection, modelId), UpstreamError);
      assert.equal(stores.connections.connection(connection.connectionId).verifiedModel, '');
    } else {
      await verifyModel(stores, connection, modelId);
      const saved = await ConnectionStore.load(stores.dataDir);
      assert.equal(saved.connection(connection.connectionId).verifiedModel, modelId);
    }
    assert.equal(complete.mock.callCount(), 1);
    const [model, context, options] = complete.mock.calls[0]!.arguments;
    assert.ok(model);
    assert.ok(context);
    assert.equal(model.id, modelId);
    assert.equal(context.messages.length, 1);
    assert.equal(options?.maxTokens, 16);
    assert.ok(options?.sessionId);
    if (stopReason === 'length') assert.match(inferenceError(result) ?? '', /output limit/);
  });
}

test('a truncated verification cannot verify a credential revision changed during the request', async (t) => {
  const { stores, connection } = await fixture();
  t.after(() => rm(stores.dataDir, { recursive: true, force: true }));
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('This regression test must not access the network.');
  });
  t.mock.method(stores.keyring, 'get', () => {
    throw new Error('This regression test must not access the OS keyring.');
  });
  t.mock.method(ModelRuntime.prototype, 'completeSimple', async () => {
    await stores.connections.change((data) => {
      const current = data.connections.find(
        (item) => item.connectionId === connection.connectionId,
      );
      assert.ok(current);
      current.revision += 1;
    });
    return fauxAssistantMessage([{ type: 'thinking', thinking: 'Checking access.' }], {
      stopReason: 'length',
    });
  });
  await assert.rejects(verifyModel(stores, connection, modelId), ConflictError);
  assert.equal(stores.connections.connection(connection.connectionId).verifiedModel, '');
});
