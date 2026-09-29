import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpServerConfig } from '@ai/agent-contracts';
import type { AdapterServerEntry } from '../dist/mcp/adapter-types.js';
import { envReferences } from '../dist/mcp/env-references.js';
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

test('an HTTP server whose URL or a header names an env var the adapter fills in needs approval', () => {
  const http = { ...bearer.http!, auth: { type: 'none' as const }, headers: {} };
  const kind = (url: string, headers: Record<string, string> = {}) =>
    launchKind({ ...bearer, http: { ...http, url, headers } });
  const oauth = (headers: Record<string, string>) =>
    launchKind({
      ...bearer,
      http: { ...http, headers, auth: { type: 'oauth', scope: null, redirectUri: null } },
    });
  // Each syntax pi-mcp-adapter's interpolateEnvVars resolves, in the URL and in a header.
  for (const reference of ['${API_KEY}', '$env:API_KEY', '{env:API_KEY}']) {
    assert.deepEqual(envReferences(`x${reference}-y`), ['API_KEY'], reference);
    assert.equal(kind(`https://api.example/mcp?k=${reference}`), 'mcp-http-env', reference);
    assert.equal(kind('https://api.example/mcp', { A: `Bearer ${reference}` }), 'mcp-http-env');
    assert.equal(oauth({ A: `!!${reference}` }), 'mcp-http-env', 'an escaped value still reads');
  }
  assert.deepEqual(envReferences('${B} $env:A {env:B} ${C}'), ['A', 'B', 'C']);
  // Literal dollars the adapter sends as they are.
  for (const literal of [
    '$5',
    '$API_KEY',
    '${API-KEY}',
    '${}',
    '$env:',
    '{env:}',
    'env:A',
    '$ {A}',
  ])
    assert.equal(kind(`https://api.example/mcp?price=${literal}`, { A: literal }), null, literal);
  assert.equal(kind('https://api.example/mcp', { 'X-Team': 'a' }), null, 'plain HTTP needs none');
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
  // Stdio fingerprints are those approvals were stored with before HTTP env references counted.
  assert.equal(approved, '74827aac2fcaea50d3f8cb69b1e4b8134c14d8f35efa3464f901d0a8ba80103a');
  assert.equal(
    fingerprint(base, entry, { id: 'kit', revision: 'a'.repeat(16) }),
    '2b04d6726b7699c1c0472210cf926a86d1ba0f155408e7d6e24c4fb002f8984d',
  );
});

test('an HTTP fingerprint binds the URL, token variable and header templates', () => {
  const launch: AdapterServerEntry = {
    url: bearer.http!.url,
    headers: { 'X-Team': 'a', 'X-Key': '${TEAM_KEY}' },
  };
  const approved = fingerprint(bearer, launch);
  const http = bearer.http!;
  const withUrl = (url: string) => fingerprint(bearer, { ...launch, url });
  const withHeaders = (headers: Record<string, string>) =>
    fingerprint(bearer, { ...launch, headers });
  const changed: [string, string][] = [
    ['origin', withUrl('https://evil.example/mcp?x=1')],
    ['path', withUrl('https://api.example/other?x=1')],
    ['query', withUrl('https://api.example/mcp?x=2')],
    ['query reference', withUrl('https://api.example/mcp?x=1&k=${API_TOKEN}')],
    [
      'token variable',
      fingerprint(
        { ...bearer, http: { ...http, auth: { type: 'bearer', tokenEnv: 'AWS' } } },
        launch,
      ),
    ],
    ['header name', withHeaders({ 'X-Other': 'a', 'X-Key': '${TEAM_KEY}' })],
    ['header value', withHeaders({ 'X-Team': 'b', 'X-Key': '${TEAM_KEY}' })],
    ['header variable', withHeaders({ 'X-Team': 'a', 'X-Key': '${AWS_SECRET}' })],
    ['header syntax', withHeaders({ 'X-Team': 'a', 'X-Key': '$env:TEAM_KEY' })],
    ['added header', withHeaders({ ...launch.headers, 'X-More': '1' })],
  ];
  for (const [field, value] of changed) assert.notEqual(value, approved, field);
  assert.equal(
    withHeaders({ 'X-Key': '${TEAM_KEY}', 'X-Team': 'a' }),
    approved,
    'header order does not matter',
  );
  // Without a token variable, the env references alone make it an env launch.
  const referenced = {
    ...bearer,
    http: { ...http, headers: launch.headers ?? {}, auth: { type: 'none' as const } },
  };
  assert.match(fingerprint(referenced, launch), /^[0-9a-f]{64}$/);
  assert.notEqual(fingerprint(referenced, launch), approved, 'token variable dropped');
  assert.throws(() =>
    fingerprint(
      { ...referenced, http: { ...referenced.http, headers: {} } },
      { url: 'https://api.example/mcp' },
    ),
  );
});

test('risky env keys', () => {
  for (const key of ['PATH', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'PYTHONPATH'])
    assert.ok(isRiskyEnvKey(key), key);
  for (const key of ['API_KEY', 'HOME_DIR', 'NODE_ENV']) assert.ok(!isRiskyEnvKey(key), key);
});
