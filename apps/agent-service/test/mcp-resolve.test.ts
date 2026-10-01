import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { McpServerConfig } from '@ai/agent-contracts';
import { McpError } from '../dist/mcp/errors.js';
import {
  expandHome,
  inheritedEnv,
  resolveHttpUrl,
  resolveLaunch,
  withConfiguredUrl,
} from '../dist/mcp/launch-resolve.js';
import { toLaunchSpec } from '../dist/mcp/servers.js';
import { httpRecord, stdioRecord } from './mcp-kit.ts';

/**
 * How a launch spec becomes what is spawned or dialed: env references filled in from the service
 * environment, `~` expanded, `!!` unescaped, nothing run, and no message that quotes a value.
 */

const ENV = {
  API_TOKEN: 'tok-1',
  TEAM: 'blue',
  A_KEY: 'a-val',
  B_KEY: 'b-val',
  C_KEY: 'c-val',
  EMPTY_VAR: '',
  HOME: '/home/user',
  PATH: '/usr/bin:/bin',
  USER: 'user',
  SHELL: '() { echo exported function; }',
};
let dir = '';
before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'mcp-resolve-')));
  await mkdir(path.join(dir, 'sub'));
  await writeFile(path.join(dir, 'a-file'), '');
});
after(() => rm(dir, { recursive: true, force: true }));

const options = (bearerToken: string | null = null) => ({
  defaultCwd: dir,
  env: { ...ENV, TEAM_DIR: dir },
  bearerToken,
});
const resolve = (record: McpServerConfig, bearerToken: string | null = null) =>
  resolveLaunch(record, toLaunchSpec(record), options(bearerToken));
const refusal = (code: string, pattern: RegExp) => (error: unknown) => {
  assert.ok(error instanceof McpError, String(error));
  assert.equal(error.code, code);
  assert.match(error.message, pattern);
  return true;
};

test('arguments are filled in, and a leading ~ is the home directory', async () => {
  const args = ['server.js', '--token=${API_TOKEN}', '~/data', '~', '$env:TEAM', '{env:TEAM}'];
  const literal = ['${UNSET_VAR}x', '$5', '${API-KEY}', '!!${TEAM}', 'a~b'];
  const launch = await resolve(stdioRecord('s', '/bin/true', [...args, ...literal]));
  assert.ok(launch.kind === 'stdio');
  assert.deepEqual(launch.args, [
    'server.js',
    '--token=tok-1',
    path.join(homedir(), 'data'),
    homedir(),
    'blue',
    'blue',
    'x',
    '$5',
    '${API-KEY}',
    '!!blue',
    'a~b',
  ]);
  assert.equal(launch.command, '/bin/true', 'the probed executable is used as it is');
});

test('env values are filled in; !! becomes a literal !; the child inherits only the listed keys', async () => {
  const env = {
    REF: '${TEAM}',
    BANG: '!!literal',
    BANGREF: '!!${TEAM}',
    MISSING: '${UNSET_VAR}',
    TILDE: '~/x',
  };
  const launch = await resolve(stdioRecord('s', '/bin/true', [], { env }));
  assert.ok(launch.kind === 'stdio');
  assert.deepEqual(launch.env, {
    HOME: '/home/user',
    PATH: '/usr/bin:/bin',
    USER: 'user',
    REF: 'blue',
    BANG: '!literal',
    BANGREF: '!blue',
    MISSING: '',
    TILDE: '~/x',
  });
  assert.deepEqual(inheritedEnv({ ...ENV, TERM: 'xterm', SYSTEMROOT: 'C:\\Windows' }, 'linux'), {
    HOME: '/home/user',
    PATH: '/usr/bin:/bin',
    TERM: 'xterm',
    USER: 'user',
  });
  assert.deepEqual(inheritedEnv({ ...ENV, SYSTEMROOT: 'C:\\Windows', TEMP: 'C:\\Temp' }, 'win32'), {
    PATH: '/usr/bin:/bin',
    SYSTEMROOT: 'C:\\Windows',
    TEMP: 'C:\\Temp',
  });
  assert.equal(expandHome('~other'), '~other');
});

test('the working directory is the authority cwd, or the configured one made absolute', async () => {
  const cwdOf = async (cwd: string | null) => {
    const launch = await resolve(stdioRecord('s', '/bin/true', [], { cwd }));
    assert.ok(launch.kind === 'stdio');
    return launch.cwd;
  };
  assert.equal(await cwdOf(null), dir);
  assert.equal(await cwdOf('sub'), path.join(dir, 'sub'));
  assert.equal(await cwdOf(path.join(dir, 'sub')), path.join(dir, 'sub'));
  assert.equal(await cwdOf('${TEAM_DIR}/sub'), path.join(dir, 'sub'));
  await assert.rejects(
    cwdOf('nowhere'),
    refusal('internal', /configured cwd does not exist: ".*nowhere"/),
  );
  await assert.rejects(cwdOf('a-file'), refusal('internal', /configured cwd is not a directory/));
  await assert.rejects(cwdOf('${UNSET_VAR}/x'), (error) => {
    assert.match(String(error), /does not exist: "\$\{UNSET_VAR\}\/x"/, 'shown as written');
    return true;
  });
});

test('an HTTP URL is filled in; an unset variable refuses the launch by name', () => {
  const url = (template: string) => resolveHttpUrl(httpRecord('h', {}, { url: template }), ENV);
  assert.equal(url('https://api.example/mcp?k=${API_TOKEN}'), 'https://api.example/mcp?k=tok-1');
  assert.equal(url('https://api.example/${TEAM}/mcp'), 'https://api.example/blue/mcp');
  assert.equal(
    url('https://api.example/mcp?k=${EMPTY_VAR}'),
    'https://api.example/mcp?k=',
    'empty is set',
  );
  assert.throws(
    () => url('https://api.example/mcp?k=${UNSET_VAR}'),
    refusal('internal', /^Missing environment variable in MCP server URL: UNSET_VAR$/),
  );
  assert.throws(
    () => url('https://x.example/?a=${U1}&b=$env:U2'),
    refusal('internal', /variables in MCP server URL: U1, U2$/),
  );
  assert.throws(
    () => url('${TEAM}'),
    refusal('internal', /URL is invalid after its environment references are filled in/),
  );
  assert.throws(
    () => resolveHttpUrl(stdioRecord('s', '/bin/true'), ENV),
    refusal('internal', /not an HTTP server/),
  );
});

test('a URL that carries a user name or password is refused, and neither is quoted', async () => {
  const fixed =
    'MCP server h URL must not carry a user name or password; send credentials in a header or as a bearer token.';
  const refused = (error: unknown) => {
    assert.ok(error instanceof McpError);
    assert.equal(error.code, 'internal');
    assert.equal(error.message, fixed, 'a fixed message, whatever the URL says');
    return true;
  };
  const withCredentials = [
    'https://user:${API_TOKEN}@api.example/mcp',
    'https://${TEAM}@api.example/mcp',
    'http://plain-user@api.example/mcp',
    'http://:plain-pass@api.example/mcp',
  ];
  for (const url of withCredentials) {
    const record = httpRecord('h', {}, { url });
    assert.throws(() => resolveHttpUrl(record, ENV), refused, url);
    await assert.rejects(resolve(record), refused, url);
  }
  // An @ elsewhere in the URL is no credential.
  for (const url of [
    'https://api.example/mcp?mail=me@x.example',
    'https://api.example/@team/mcp',
  ]) {
    assert.equal(resolveHttpUrl(httpRecord('h', {}, { url }), ENV), url);
  }
});

test('the configured URL replaces the filled-in one wherever a text quotes it', () => {
  const configured = 'https://Api.Example/${TEAM}/mcp?a=${API_TOKEN}&b=$env:A_KEY#part';
  const record = httpRecord('h', {}, { url: configured });
  const filled = 'https://Api.Example/blue/mcp?a=tok-1&b=a-val#part';
  const normalized = new URL(filled).href;
  const withoutFragment = normalized.replace('#part', '');
  const hide = (text: string) => withConfiguredUrl(text, record, ENV);

  assert.equal(hide(`resource ${filled} mismatch`), `resource ${configured} mismatch`);
  assert.equal(hide(`resource ${normalized} mismatch`), `resource ${configured} mismatch`);
  assert.equal(hide(`resource ${withoutFragment} mismatch`), `resource ${configured} mismatch`);
  assert.equal(
    hide(normalized),
    configured,
    'the longer form is replaced whole, fragment included',
  );
  assert.equal(
    hide(`${filled} then ${withoutFragment}`),
    `${configured} then ${configured}`,
    'every quote',
  );
  assert.equal(hide('no URL here, but tok-1 and blue'), 'no URL here, but tok-1 and blue');

  const literal = httpRecord('l', {}, { url: 'https://api.example/mcp' });
  const quote = 'failed: https://api.example/mcp';
  assert.equal(withConfiguredUrl(quote, literal, ENV), quote, 'nothing to hide without references');
  assert.equal(withConfiguredUrl(quote, stdioRecord('s', '/bin/true'), ENV), quote);
});

test('headers are filled in, and !! unescapes to a literal !', async () => {
  const headers = {
    Authorization: 'Bearer ${API_TOKEN}',
    'X-A': '$env:A_KEY',
    'X-B': '{env:B_KEY}',
    'X-Bang': '!!${C_KEY}',
    'X-Missing': 'k=${UNSET_VAR}',
    'X-Plain': 'plain',
  };
  const launch = await resolve(httpRecord('h', {}, { headers }));
  assert.ok(launch.kind === 'streamable-http');
  assert.deepEqual(launch.headers, {
    Authorization: 'Bearer tok-1',
    'X-A': 'a-val',
    'X-B': 'b-val',
    'X-Bang': '!c-val',
    'X-Missing': 'k=',
    'X-Plain': 'plain',
  });
  assert.deepEqual(launch.credential, { type: 'none' });
  await assert.rejects(
    resolve(httpRecord('h', {}, { headers: { 'X-Bad': 'line\nbreak${TEAM}' } })),
    (error) => {
      assert.match(String(error), /header "X-Bad" is not valid/);
      assert.ok(!String(error).includes('blue'), 'no value in the message');
      return true;
    },
  );
});

test('an OAuth server refuses a header that would go out without its credential', async () => {
  const oauth = { auth: { type: 'oauth' as const, scope: null, redirectUri: null } };
  const withHeaders = (headers: Record<string, string>) =>
    resolve(httpRecord('o', {}, { ...oauth, headers }));
  const missing = refusal('internal', /^Missing environment credential in OAuth HTTP headers$/);
  await assert.rejects(withHeaders({ 'X-Missing': 'k=${UNSET_VAR}' }), missing);
  await assert.rejects(withHeaders({ 'X-Empty': '${EMPTY_VAR}' }), missing);
  await assert.rejects(
    withHeaders({ 'X-Blank': ' ' }),
    refusal('internal', /^Failed to resolve OAuth HTTP headers$/),
  );
  const ok = await withHeaders({ Authorization: 'Bearer ${API_TOKEN}', 'X-Bang': '!!${C_KEY}' });
  assert.ok(ok.kind === 'streamable-http');
  assert.deepEqual(ok.headers, { Authorization: 'Bearer tok-1', 'X-Bang': '!c-val' });
  assert.deepEqual(ok.credential, { type: 'oauth' });
});

test('a bearer token is used exactly as stored, and its absence is a missing credential', async () => {
  const bearer = httpRecord('b', {}, { auth: { type: 'bearer', tokenEnv: 'X' } });
  for (const token of ['abc${TEAM}', '!!abc', '!echo hi', 'plain']) {
    const launch = await resolve(bearer, token);
    assert.ok(launch.kind === 'streamable-http');
    assert.deepEqual(launch.credential, { type: 'bearer', token });
  }
  await assert.rejects(resolve(bearer), refusal('auth_required', /missing its bearer credential/));
  await assert.rejects(
    resolve(bearer, 'no\nnewline'),
    refusal('auth_required', /cannot be sent as an HTTP header/),
  );
});

test('a value that starts with a single ! is never resolved, whoever asks', async () => {
  const command = await resolve(
    stdioRecord('s', '/bin/true', [], { env: { X: '!touch /tmp/never' } }),
  ).catch((e: unknown) => e);
  assert.ok(command instanceof McpError && command.code === 'forbidden');
  assert.match(command.message, /sets env X to a value starting with "!"/);
  assert.ok(!command.message.includes('touch'), 'the value is not quoted');
  await assert.rejects(
    resolve(httpRecord('h', {}, { headers: { 'X-Cmd': '!echo hi' } })),
    refusal('forbidden', /sets header X-Cmd/),
  );
});
