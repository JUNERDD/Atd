import assert from 'node:assert/strict';
import { test } from 'node:test';
import { credentialAuthError, type TaskRun } from '@atd/agent-contracts';
import { AuthRequired } from '../dist/credentials.js';
import { keyringAccount } from '../dist/credentials/keyring.js';
import { openRunModel } from '../dist/run-model.js';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

function runFixture(connectionId: string, modelId: string): TaskRun {
  return {
    id: 'run-cred-health',
    taskId: 'task-cred-health',
    rootTaskId: 'task-cred-health',
    status: 'queued',
    error: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    snapshot: {
      model: { connectionId, modelId },
      instructions: '',
      skills: [],
      mcpServers: [],
      subagents: [],
    },
  } as unknown as TaskRun;
}

test('detects unreadable and missing keychain credentials while preserving connection config', async (t) => {
  const keyring = installMemoryKeyring();
  const harness = await startTestService();
  t.after(async () => {
    keyring.state.fail = () => false;
    await harness.stop();
  });

  const create = await harness.call('/v1/providers', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'openai',
      name: 'OpenAI Keychain Test',
      baseUrl: '',
      authType: 'api_key',
      defaultModel: 'gpt-4.1',
      options: {},
      customModels: [],
      credential: { type: 'api_key', key: 'sk-initial-key' },
    }),
  });
  assert.equal(create.status, 200, await create.clone().text());
  const { connection } = (await create.json()) as {
    connection: {
      connectionId: string;
      configurationId: string;
      revision: number;
      connected: boolean;
      hasCredential: boolean;
    };
  };
  assert.equal(connection.connected, true);
  assert.equal(connection.hasCredential, true);

  const initialStatus = await harness.call(`/v1/providers/${connection.connectionId}/status`);
  assert.equal(initialStatus.status, 200);
  const initialStatusBody = (await initialStatus.json()) as {
    readable?: boolean;
    credentialIssue?: string;
    modelCheck: string;
  };
  assert.equal(initialStatusBody.readable, true);
  assert.equal(initialStatusBody.credentialIssue, undefined);
  assert.equal(initialStatusBody.modelCheck, 'passed');

  const account = keyringAccount(connection.connectionId);

  // Simulate post-update macOS keychain ACL mismatch on read while metadata remains connected.
  keyring.state.fail = (op, target) => op === 'get' && target === account;

  const unreadableStatus = await harness.call(`/v1/providers/${connection.connectionId}/status`);
  assert.equal(unreadableStatus.status, 200);
  const unreadableBody = (await unreadableStatus.json()) as {
    readable?: boolean;
    credentialIssue?: string;
    modelCheck: string;
    connection: { connected: boolean; hasCredential: boolean };
  };
  assert.equal(unreadableBody.readable, false);
  assert.equal(unreadableBody.credentialIssue, 'unreadable');
  assert.equal(unreadableBody.modelCheck, 'failed');
  assert.equal(unreadableBody.connection.connected, true);
  assert.equal(unreadableBody.connection.hasCredential, true);

  const listedAfterStatus = await harness.call('/v1/providers');
  assert.equal(listedAfterStatus.status, 200);
  const listedBody = (await listedAfterStatus.json()) as {
    credentialIssues?: Record<string, string>;
    connections: Array<{ connectionId: string; connected: boolean; hasCredential: boolean }>;
  };
  assert.equal(listedBody.credentialIssues?.[connection.connectionId], 'unreadable');
  const row = listedBody.connections.find((item) => item.connectionId === connection.connectionId);
  assert.equal(row?.connected, true);
  assert.equal(row?.hasCredential, true);

  await assert.rejects(
    () => openRunModel(harness.config.paths, runFixture(connection.connectionId, 'gpt-4.1')),
    (error) => {
      assert.ok(error instanceof AuthRequired);
      assert.equal(credentialAuthError(error.message), 'credential_unreadable');
      return true;
    },
  );

  // Stop throwing ACL error and delete the secret directly to simulate a missing keychain entry.
  keyring.state.fail = () => false;
  keyring.remove(harness.config.serviceId, account);

  await assert.rejects(
    () => openRunModel(harness.config.paths, runFixture(connection.connectionId, 'gpt-4.1')),
    (error) => {
      assert.ok(error instanceof AuthRequired);
      assert.equal(credentialAuthError(error.message), 'credential_missing');
      return true;
    },
  );

  const listedMissing = (await (await harness.call('/v1/providers')).json()) as {
    credentialIssues?: Record<string, string>;
  };
  assert.equal(listedMissing.credentialIssues?.[connection.connectionId], 'missing');

  // Re-saving the API key restores readability and clears the recorded issue.
  const connect = await harness.call(`/v1/providers/${connection.connectionId}/connect`, {
    method: 'POST',
    body: JSON.stringify({
      connectionId: connection.connectionId,
      providerId: 'openai',
      configurationId: connection.configurationId,
      credential: { type: 'api_key', key: 'sk-restored-key' },
    }),
  });
  assert.equal(connect.status, 200, await connect.clone().text());

  const listedRestored = (await (await harness.call('/v1/providers')).json()) as {
    credentialIssues?: Record<string, string>;
  };
  assert.equal(listedRestored.credentialIssues, undefined);
});
