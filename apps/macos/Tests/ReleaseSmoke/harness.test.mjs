import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { requireIntelRunner } from './app-process.mjs';
import { readEndpoint, until } from './service-client.mjs';

await test('endpoint must belong to the isolated loopback service before sending its token', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'atd-endpoint-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal(await readEndpoint(directory), null);
  await mkdir(path.join(directory, 'auth'));
  const endpoint = {
    version: 1,
    protocolVersion: '1',
    host: '127.0.0.1',
    port: 12345,
    url: 'http://127.0.0.1:12345',
    pid: 100,
    serviceId: 'owned-service',
  };
  await writeFile(
    path.join(directory, 'auth/token'),
    JSON.stringify({ serviceId: endpoint.serviceId, token: 'a'.repeat(48) }),
  );
  const save = (value) => writeFile(path.join(directory, 'endpoint.json'), JSON.stringify(value));
  await save(endpoint);
  assert.equal((await readEndpoint(directory)).serviceId, endpoint.serviceId);
  for (const invalid of [
    { url: 'https://example.com' },
    { host: '0.0.0.0' },
    { serviceId: 'other-service' },
    { pid: 1 },
  ]) {
    await save({ ...endpoint, ...invalid });
    await assert.rejects(() => readEndpoint(directory));
  }
  await save(endpoint);
  await writeFile(path.join(directory, 'auth/token'), '{"token":"never-print-this');
  await assert.rejects(() => readEndpoint(directory), {
    message: 'Invalid service endpoint or credential JSON',
  });
});

await test('readiness polling never retries failed assertions', async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      until('invalid state', () => {
        attempts++;
        assert.fail('wrong architecture');
      }),
    /wrong architecture/,
  );
  assert.equal(attempts, 1);
});

await test('Release lifecycle refuses developer and self-hosted machines', async () => {
  const previous = { actions: process.env.GITHUB_ACTIONS, runner: process.env.RUNNER_ENVIRONMENT };
  try {
    process.env.GITHUB_ACTIONS = 'false';
    await assert.rejects(requireIntelRunner, /Run this suite in GitHub Actions/);
    process.env.GITHUB_ACTIONS = 'true';
    process.env.RUNNER_ENVIRONMENT = 'self-hosted';
    await assert.rejects(requireIntelRunner, /A fresh hosted runner is required/);
  } finally {
    if (previous.actions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous.actions;
    if (previous.runner === undefined) delete process.env.RUNNER_ENVIRONMENT;
    else process.env.RUNNER_ENVIRONMENT = previous.runner;
  }
});
