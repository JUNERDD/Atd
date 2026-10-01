import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { McpHttpError } from '@earendil-works/pi-mcp';
import { diagnoseConnectError, localNetworkHint } from '../dist/mcp/connect-errors.js';
import { McpError } from '../dist/mcp/errors.js';
import { mcpErrorStatus } from '../dist/mcp/routes.js';
import type { McpTransportFactory } from '../dist/mcp/types.js';
import { FakeMcpServer, waitFor } from './mcp-fake-server.ts';
import { standardTools } from './mcp-fake-tools.ts';
import { httpRecord, kitFor, memoryLog, stdioRecord } from './mcp-kit.ts';

/**
 * What a failed connect says: a URL with credentials is refused before anything is dialed, no
 * message, row or log line quotes a URL with its variables filled in, and a connect that macOS
 * refuses on the local network says so.
 */

/** Sets an environment variable for the test, and removes it when the test ends. */
function withEnv(t: TestContext, name: string, value: string) {
  process.env[name] = value;
  t.after(() => void delete process.env[name]);
}

test('a URL with credentials is refused before any dial, and none of them is quoted', async (t) => {
  withEnv(t, 'PROBE_PASS', 'pw-9f3a');
  const fake = new FakeMcpServer({ tools: standardTools() });
  const { log, lines } = memoryLog();
  const url = 'http://usr-7c1e:${PROBE_PASS}@127.0.0.1:9/mcp';
  const kit = kitFor(t, [httpRecord('userinfo', {}, { url })], { transports: fake.factory, log });
  const fixed =
    'MCP server userinfo URL must not carry a user name or password; send credentials in a header or as a bearer token.';
  await assert.rejects(kit.connections.connect('userinfo'), (error) => {
    assert.ok(error instanceof McpError);
    assert.equal(error.code, 'internal');
    assert.equal(error.message, fixed);
    return true;
  });
  assert.equal(fake.launches.length, 0, 'nothing was dialed, so nothing was retried');
  assert.equal(kit.states.get('userinfo'), 'error');
  assert.equal(kit.states.lastError('userinfo'), fixed);
  for (const secret of ['usr-7c1e', 'pw-9f3a']) {
    assert.deepEqual(
      lines.filter((line) => line.includes(secret)),
      [],
      `no log line quotes ${secret}`,
    );
  }
});

test('a failed connect quotes the URL as configured in its message and its row', async (t) => {
  withEnv(t, 'PROBE_KEY', 'key-4d2b');
  const transports: McpTransportFactory = (launch) => {
    assert.ok(launch.kind !== 'stdio');
    throw new Error(`Protected resource ${launch.url} does not match the server`);
  };
  const { log, lines } = memoryLog();
  const record = httpRecord('quote', {}, { url: 'https://fake.example/mcp?key=${PROBE_KEY}' });
  const kit = kitFor(t, [record], { transports, log });
  await assert.rejects(kit.connections.connect('quote'), (error) => {
    assert.ok(error instanceof McpError);
    assert.equal(error.code, 'internal');
    assert.equal(mcpErrorStatus(error.code), 500, 'the status does not change');
    assert.match(
      error.message,
      /Protected resource https:\/\/fake\.example\/mcp\?key=\$\{PROBE_KEY\} does not/,
    );
    assert.equal(kit.states.lastError('quote'), error.message);
    return true;
  });
  assert.deepEqual(
    lines.filter((line) => line.includes('key-4d2b')),
    [],
  );
});

test("the pool's debug logs quote the URL as configured too", async (t) => {
  withEnv(t, 'PROBE_KEY', 'key-4d2b');
  const filled = 'https://fake.example/mcp?key=key-4d2b';
  const fake = new FakeMcpServer({ tools: standardTools() });
  const { log, lines } = memoryLog();
  const record = httpRecord('logs', {}, { url: 'https://fake.example/mcp?key=${PROBE_KEY}' });
  const kit = kitFor(t, [record], { transports: fake.factory, log });
  fake.failNext('initialize', 1, () => new McpHttpError(503, `bad gateway from ${filled}`));
  await kit.connections.connect('logs');
  fake.failNext('tools/list', 1, () => new Error(`no catalog from ${filled}`));
  await fake.notifyListChanged('tools');
  await waitFor(() => lines.some((line) => line.includes('MCP catalog recount failed.')));

  for (const message of ['MCP connect failed transiently', 'MCP catalog recount failed']) {
    const line = lines.find((entry) => entry.includes(message));
    assert.ok(line, `${message} was logged`);
    assert.match(line, /https:\/\/fake\.example\/mcp\?key=\$\{PROBE_KEY\}/);
  }
  assert.deepEqual(
    lines.filter((line) => line.includes('key-4d2b')),
    [],
  );
});

const errno = (code: string) =>
  Object.assign(new Error(`connect ${code} 192.168.1.20:8080`), { code });
const fetchFailed = (cause: unknown) => new TypeError('fetch failed', { cause });
const LAN = 'http://192.168.1.20:8080/mcp';

test('the Local Network hint needs macOS, a routing errno and a literal private address', () => {
  const failure = fetchFailed(errno('EHOSTUNREACH'));
  const hint = localNetworkHint(failure, LAN, 'darwin');
  assert.match(hint, /^ — EHOSTUNREACH — macOS Local Network Privacy may be blocking access\. /);
  assert.match(hint, /Check System Settings > Privacy & Security > Local Network for the app/);
  assert.match(hint, /Routing or firewall problems can also cause this error\.$/);
  for (const platform of ['linux', 'win32'] as const) {
    assert.equal(localNetworkHint(failure, LAN, platform), '');
  }

  // Errnos anywhere in the chain count, an AggregateError's members too; each is named once.
  const several = new AggregateError([errno('ENETUNREACH'), errno('EACCES'), errno('ENETUNREACH')]);
  assert.match(localNetworkHint(fetchFailed(several), LAN, 'darwin'), /^ — ENETUNREACH, EACCES — /);
  for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
    assert.equal(localNetworkHint(fetchFailed(errno(code)), LAN, 'darwin'), '', code);
  }

  const local = ['10.0.0.5', '172.16.9.1', '172.31.255.255', '192.168.0.1', '169.254.1.1'];
  for (const host of [...local, '[fd12:3456::1]', '[fe80::1]']) {
    assert.notEqual(localNetworkHint(failure, `http://${host}:80/mcp`, 'darwin'), '', host);
  }
  const elsewhere = ['172.32.0.1', '8.8.8.8', '127.0.0.1', '[::1]', 'localhost', 'nas.local'];
  for (const host of elsewhere) {
    assert.equal(localNetworkHint(failure, `http://${host}:80/mcp`, 'darwin'), '', host);
  }
  assert.equal(localNetworkHint(failure, undefined, 'darwin'), '', 'a stdio server has no URL');
});

test('the hint ends the message it belongs to; without it the wording is unchanged', () => {
  const nas = httpRecord('nas', {}, { url: LAN });
  const unreachable = fetchFailed(errno('EHOSTUNREACH'));
  const denied = fetchFailed(errno('EACCES'));
  const detail = 'fetch failed: connect EHOSTUNREACH 192.168.1.20:8080';

  const withHint = diagnoseConnectError(nas, unreachable, LAN, 'darwin');
  assert.ok(withHint.startsWith(`MCP server nas is unreachable: ${detail} — EHOSTUNREACH — macOS`));
  assert.ok(withHint.endsWith('can also cause this error.'));
  assert.ok(!withHint.includes('..'), 'one full stop');
  assert.match(
    diagnoseConnectError(nas, denied, LAN, 'darwin'),
    /^MCP server nas failed to connect: fetch failed: connect EACCES 192\.168\.1\.20:8080 — EACCES — macOS/,
  );

  assert.equal(
    diagnoseConnectError(nas, unreachable, LAN, 'linux'),
    `MCP server nas is unreachable: ${detail}.`,
  );
  assert.equal(
    diagnoseConnectError(nas, denied, LAN, 'linux'),
    'MCP server nas failed to connect: fetch failed: connect EACCES 192.168.1.20:8080',
  );
  const child = stdioRecord('child', 'missing');
  assert.doesNotMatch(diagnoseConnectError(child, denied, undefined, 'darwin'), /Local Network/);
});

test('a connect to an unreachable private address is not retried, and says why on macOS', async (t) => {
  let dials = 0;
  const transports: McpTransportFactory = () => {
    dials += 1;
    throw fetchFailed(errno('EHOSTUNREACH'));
  };
  const kit = kitFor(t, [httpRecord('nas', {}, { url: LAN })], { transports });
  await assert.rejects(kit.connections.connect('nas'), (error) => {
    assert.ok(error instanceof McpError);
    assert.equal(error.code, 'internal');
    assert.match(error.message, /is unreachable: fetch failed: connect EHOSTUNREACH/);
    assert.equal(error.message.includes('Local Network Privacy'), process.platform === 'darwin');
    assert.equal(kit.states.lastError('nas'), error.message);
    return true;
  });
  assert.equal(dials, 1);
});
