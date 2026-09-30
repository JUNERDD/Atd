import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { McpHttp, McpServerConfig } from '@ai/agent-contracts';
import { envReferences, httpEnvReads } from '../dist/mcp/env-references.js';
import { launchFingerprint, launchKind } from '../dist/mcp/launch-fingerprint.js';
import { commandValueField, toLaunchSpec } from '../dist/mcp/servers.js';
import type { McpLaunchSpec } from '../dist/mcp/types.js';
import { at, httpRecord, stdioRecord } from './mcp-kit.ts';

/**
 * Launch approvals stored before the move off pi-mcp-adapter must keep matching. These
 * fingerprints were computed by the code of that time from its server entry (key: 32 bytes of 7,
 * default cwd `/service`); `spec` is the entry's launch fields, which `toLaunchSpec` has to
 * reproduce (with the resolved executable in place of a stdio command), because they are what the
 * fingerprint hashes. The fingerprint tests proper: launch-fingerprint.test.ts.
 */

const KEY = Buffer.alloc(32, 7);
const kit = { id: 'kit', revision: 'rev-0001' };

interface Golden {
  label: string;
  record: McpServerConfig;
  kind: 'mcp-stdio' | 'mcp-http-env';
  plugin?: typeof kit;
  /** The executable the connect path resolved the command to. */
  command?: string;
  spec: McpLaunchSpec;
  fingerprint: string;
}

const sse = (url: string, headers: Record<string, string>, tokenEnv: string) =>
  httpRecord(
    'golden-sse',
    {},
    { transport: 'sse', url, headers, auth: { type: 'bearer', tokenEnv } },
  );

const goldens: Golden[] = [
  {
    label: 'stdio with env references and a configured cwd',
    record: stdioRecord('golden-stdio', 'node', ['server.js', '--token=${API_TOKEN}', '~/data'], {
      env: { API_KEY: 'sk-live-123', REF: '${TEAM}', BANG: '!!literal' },
      cwd: '/work',
    }),
    kind: 'mcp-stdio',
    command: '/usr/local/bin/node',
    spec: {
      command: '/usr/local/bin/node',
      args: ['server.js', '--token=${API_TOKEN}', '~/data'],
      env: { API_KEY: 'sk-live-123', REF: '${TEAM}', BANG: '!!literal' },
      inheritEnv: false,
      cwd: '/work',
    },
    fingerprint: '9521da159620226ad9da552eff51541f66c89f14cbe4fbcfbf887fb822d4cad6',
  },
  {
    label: 'stdio without a cwd',
    record: stdioRecord('golden-stdio-2', '/bin/sh', ['-c', 'exec server']),
    kind: 'mcp-stdio',
    command: '/bin/sh',
    spec: { command: '/bin/sh', args: ['-c', 'exec server'], env: {}, inheritEnv: false },
    fingerprint: '201be7019c4fc62c5006f32a6b0a24bafdb316d7cdcd0e07b6410cb741953b5b',
  },
  {
    label: 'a plugin stdio server',
    record: stdioRecord('kit:db', '/opt/kit/bin/db', ['--mode', 'a'], {
      env: { DB_URL: 'postgres://x' },
      cwd: '/opt/kit',
    }),
    kind: 'mcp-stdio',
    plugin: kit,
    command: '/opt/kit/bin/db',
    spec: {
      command: '/opt/kit/bin/db',
      args: ['--mode', 'a'],
      env: { DB_URL: 'postgres://x' },
      inheritEnv: false,
      cwd: '/opt/kit',
    },
    fingerprint: '27257e23d5692799193770e0901274321060e1b9919fbdf0bcd7018d1fcc78fd',
  },
  {
    label: 'a bearer from an env var, references in the URL and a header',
    record: httpRecord(
      'golden-http',
      {},
      {
        url: 'https://api.example/mcp?k=${API_KEY}',
        headers: { Authorization: 'Bearer ${TEAM_KEY}', 'X-Team': 'a' },
        auth: { type: 'bearer', tokenEnv: 'API_TOKEN' },
      },
    ),
    kind: 'mcp-http-env',
    spec: {
      url: 'https://api.example/mcp?k=${API_KEY}',
      headers: { Authorization: 'Bearer ${TEAM_KEY}', 'X-Team': 'a' },
    },
    fingerprint: '3a4ddbf8effbb883b423760107fee926f3d991d5b709dc22ae8afbb2ec599026',
  },
  {
    label: 'every reference syntax and an escaped one in headers',
    record: httpRecord(
      'golden-refs',
      {},
      {
        url: 'https://refs.example/mcp',
        headers: {
          'X-A': '$env:A_KEY',
          'X-B': '{env:B_KEY}',
          'X-Bang': '!!${C_KEY}',
          'X-Plain': 'plain',
        },
      },
    ),
    kind: 'mcp-http-env',
    spec: {
      url: 'https://refs.example/mcp',
      headers: {
        'X-A': '$env:A_KEY',
        'X-B': '{env:B_KEY}',
        'X-Bang': '!!${C_KEY}',
        'X-Plain': 'plain',
      },
    },
    fingerprint: '951aec689f84f5818d493f4ddef333bc33d9ffdaa1976900d423da79deee716c',
  },
  {
    label: 'a plugin HTTP server',
    record: httpRecord(
      'kit:remote',
      {},
      { url: 'https://kit.example/mcp', headers: { Authorization: 'Bearer ${KIT_TOKEN}' } },
    ),
    kind: 'mcp-http-env',
    plugin: kit,
    spec: { url: 'https://kit.example/mcp', headers: { Authorization: 'Bearer ${KIT_TOKEN}' } },
    fingerprint: '464180f665b1a0dd2335ed27c305a558afa9058e8094311c5098599dc94cb1dd',
  },
  {
    label: 'an OAuth server whose header names a variable',
    record: httpRecord(
      'golden-oauth',
      {},
      {
        url: 'https://oauth.example/mcp',
        headers: { 'X-Tenant': '${TENANT}' },
        auth: { type: 'oauth', scope: null, redirectUri: null },
      },
    ),
    kind: 'mcp-http-env',
    spec: { url: 'https://oauth.example/mcp', headers: { 'X-Tenant': '${TENANT}' } },
    fingerprint: 'a4882845c2495bc42b51cac52d1dd1c4b9bf3b25a5b8e7b28af9c07a1d5ad4b6',
  },
  {
    label: 'a legacy SSE server with a bearer from an env var',
    record: sse('https://sse.example/sse', {}, 'SSE_TOKEN'),
    kind: 'mcp-http-env',
    spec: { url: 'https://sse.example/sse', headers: {} },
    fingerprint: '78d1a5d41d56350dffbf656b3b3733f9400d1b4cf652cb9b21032067f73f5ecd',
  },
];

test('every launch spec and fingerprint of the adapter era is reproduced', () => {
  for (const { label, record, kind, plugin, command, spec, fingerprint } of goldens) {
    const launch: McpLaunchSpec = { ...toLaunchSpec(record), ...(command ? { command } : {}) };
    assert.deepEqual(launch, spec, `${label}: launch spec`);
    assert.equal(launchKind(record), kind, `${label}: kind`);
    const input = { record, entry: launch, plugin: plugin ?? null, defaultCwd: '/service' };
    assert.equal(launchFingerprint(KEY, input), fingerprint, `${label}: fingerprint`);
  }
});

/** The launch kind of golden `index` after `patch` changed its HTTP half. */
function kindWith(index: number, patch: Partial<McpHttp>) {
  const { record } = at(goldens, index);
  assert.ok(record.http);
  return launchKind({ ...record, http: { ...record.http, ...patch } });
}

test('servers that needed no approval still need none', () => {
  assert.equal(kindWith(4, { headers: { 'X-Team': 'a' } }), null, 'plain HTTP');
  assert.equal(kindWith(6, { headers: {} }), null, 'OAuth without references');
  const blank = {
    url: 'https://api.example/mcp',
    headers: {},
    auth: { type: 'bearer' as const, tokenEnv: ' ' },
  };
  assert.equal(kindWith(3, blank), null, 'a bearer with a blank variable name');
});

test('env references and command values are read the way the service always read them', () => {
  assert.equal(commandValueField({ env: { X: '!touch /tmp/x' } }), 'env X');
  assert.equal(commandValueField({ headers: { 'X-Cmd': '!echo hi' } }), 'header X-Cmd');
  assert.equal(commandValueField({ env: { X: '!!literal' } }), null, 'the escape is a literal');
  assert.equal(commandValueField({ headers: { 'X-Bang': '!!literal' } }), null);
  assert.equal(
    commandValueField({ env: { A: 'ok', B: '!cmd' }, headers: { H: '!cmd2' } }),
    'env B',
  );
  assert.equal(commandValueField({ env: { A: '${X}' }, headers: { H: 'Bearer ${Y}' } }), null);
  const references: [string, string[]][] = [
    ['Bearer ${TEAM_KEY}', ['TEAM_KEY']],
    ['$env:A_KEY', ['A_KEY']],
    ['{env:B_KEY}', ['B_KEY']],
    ['!!${C_KEY}', ['C_KEY']],
    ['${B} $env:A {env:B} ${C}', ['A', 'B', 'C']],
    ['https://api.example/mcp?k=${API_KEY}&j=$env:J', ['API_KEY', 'J']],
    ...['$5', '$API_KEY', '${API-KEY}', '${}', '$env:', '{env:}', 'env:A', '$ {A}'].map(
      (literal): [string, string[]] => [literal, []],
    ),
  ];
  for (const [text, names] of references) assert.deepEqual(envReferences(text), names, text);
  const bearer = at(goldens, 3).record.http;
  assert.ok(bearer);
  const reads = httpEnvReads(bearer.url, bearer.headers);
  assert.deepEqual(reads.url, ['API_KEY']);
  assert.deepEqual(
    [...reads.headers],
    [
      ['Authorization', ['TEAM_KEY']],
      ['X-Team', []],
    ],
  );
  assert.deepEqual(reads.names, ['API_KEY', 'TEAM_KEY']);
  const refs = at(goldens, 4).record.http;
  assert.deepEqual(httpEnvReads(refs?.url ?? '', refs?.headers ?? {}).names, [
    'A_KEY',
    'B_KEY',
    'C_KEY',
  ]);
});
