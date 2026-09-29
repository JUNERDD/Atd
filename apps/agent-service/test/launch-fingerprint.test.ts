import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpServerConfig } from '@ai/agent-contracts';
import type { AdapterServerEntry } from '../dist/mcp/adapter-types.js';
import { isRiskyEnvKey, launchFingerprint, launchKind } from '../dist/mcp/launch-fingerprint.js';

/**
 * What a launch approval binds: every field that decides what runs (or where a service env value
 * goes) changes the fingerprint, and nothing else does.
 */

const KEY = Buffer.alloc(32, 7);

const base: McpServerConfig = {
  serverId: 'local',
  revision: 1,
  connectionId: 'conn-local',
  transport: 'stdio',
  stdio: { command: 'node', args: ['server.js'], env: { TOKEN: 'secret' }, cwd: '/work' },
  http: null,
  principal: '',
  isolateByTask: false,
  exposeResources: false,
  approveTools: true,
  includeTools: [],
  excludeTools: [],
  requestTimeoutMs: null,
  disabled: false,
};

const entry: AdapterServerEntry = {
  command: '/usr/local/bin/node',
  args: ['server.js'],
  env: { TOKEN: 'secret' },
  inheritEnv: false,
  cwd: '/work',
};

const bearer: McpServerConfig = {
  ...base,
  serverId: 'remote',
  transport: 'streamable-http',
  stdio: null,
  http: {
    url: 'https://api.example/mcp?x=1',
    transport: 'streamable-http',
    headers: { 'X-Team': 'a' },
    auth: { type: 'bearer', tokenEnv: 'API_TOKEN' },
  },
};

const fingerprint = (
  record: McpServerConfig,
  launch: AdapterServerEntry,
  plugin: { id: string; revision: string } | null = null,
  key = KEY,
) => launchFingerprint(key, { record, entry: launch, plugin, defaultCwd: '/service' });

test('which servers need a launch approval', () => {
  assert.equal(launchKind(base), 'mcp-stdio');
  assert.equal(launchKind(bearer), 'mcp-http-env');
  const http = bearer.http;
  assert.ok(http);
  const withAuth = (auth: NonNullable<McpServerConfig['http']>['auth']) =>
    launchKind({ ...bearer, http: { ...http, auth } });
  assert.equal(withAuth({ type: 'none' }), null, 'plain HTTP needs none');
  assert.equal(withAuth({ type: 'bearer', tokenEnv: ' ' }), null, 'a keyring bearer reads no env');
  assert.equal(withAuth({ type: 'oauth', scope: null, redirectUri: null }), null);
});

test('a stdio fingerprint is stable and binds every launch field', () => {
  const approved = fingerprint(base, entry);
  assert.match(approved, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint(base, { ...entry, env: { TOKEN: 'secret' } }), approved, 'stable');
  const changed: [string, string][] = [
    ['command', fingerprint({ ...base, stdio: { ...base.stdio!, command: 'nodejs' } }, entry)],
    ['resolved command (PATH)', fingerprint(base, { ...entry, command: '/opt/node' })],
    ['args', fingerprint(base, { ...entry, args: ['server.js', '--x'] })],
    ['arg order', fingerprint(base, { ...entry, args: ['--x', 'server.js'] })],
    ['cwd', fingerprint(base, { ...entry, cwd: '/elsewhere' })],
    ['default cwd', fingerprint(base, { ...entry, cwd: undefined })],
    ['env value', fingerprint(base, { ...entry, env: { TOKEN: 'other' } })],
    ['env key', fingerprint(base, { ...entry, env: { TOKEN2: 'secret' } })],
    ['added env', fingerprint(base, { ...entry, env: { TOKEN: 'secret', NODE_OPTIONS: '-r x' } })],
    ['inherit env', fingerprint(base, { ...entry, inheritEnv: true })],
    ['server id', fingerprint({ ...base, serverId: 'other' }, entry)],
    ['plugin', fingerprint(base, entry, { id: 'kit', revision: 'a'.repeat(16) })],
    ['key', fingerprint(base, entry, null, Buffer.alloc(32, 8))],
  ];
  for (const [field, value] of changed) assert.notEqual(value, approved, field);
  assert.notEqual(
    fingerprint(base, entry, { id: 'kit', revision: 'a'.repeat(16) }),
    fingerprint(base, entry, { id: 'kit', revision: 'b'.repeat(16) }),
    'a plugin update is a new revision',
  );
  // The record's own revision counter is not a launch field.
  assert.equal(fingerprint({ ...base, revision: 9 }, entry), approved);
});

test('an HTTP fingerprint binds origin, path, token variable and header names only', () => {
  const launch: AdapterServerEntry = { url: bearer.http!.url, headers: { 'X-Team': 'a' } };
  const approved = fingerprint(bearer, launch);
  const http = bearer.http!;
  const withUrl = (url: string) => fingerprint(bearer, { ...launch, url });
  assert.notEqual(withUrl('https://evil.example/mcp'), approved, 'origin');
  assert.notEqual(withUrl('https://api.example/other'), approved, 'path');
  assert.equal(withUrl('https://api.example/mcp?x=2'), approved, 'query is not bound');
  assert.notEqual(
    fingerprint(
      { ...bearer, http: { ...http, auth: { type: 'bearer', tokenEnv: 'AWS_KEY' } } },
      launch,
    ),
    approved,
    'token variable',
  );
  assert.notEqual(fingerprint(bearer, { ...launch, headers: { 'X-Other': 'a' } }), approved);
  assert.equal(fingerprint(bearer, { ...launch, headers: { 'X-Team': 'b' } }), approved, 'values');
  assert.throws(() =>
    fingerprint({ ...bearer, http: { ...http, auth: { type: 'none' } } }, launch),
  );
});

test('risky env keys', () => {
  for (const key of ['PATH', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'PYTHONPATH'])
    assert.ok(isRiskyEnvKey(key), key);
  for (const key of ['API_KEY', 'HOME_DIR', 'NODE_ENV']) assert.ok(!isRiskyEnvKey(key), key);
});
