import { describe, expect, it, vi } from 'vitest';
import type { McpLaunchApprovalDetails } from '@ai/agent-contracts';
import type { ConfirmRequest } from '../confirm-dialog';
import { CANCEL_COOLDOWN_MS, McpApprovalGate, describeLaunch } from './mcp-approval';

const FINGERPRINT = 'a'.repeat(64);
const OPTIONS = { baseUrl: 'http://127.0.0.1:4999', token: 'main-token' };

const details: McpLaunchApprovalDetails = {
  serverId: 'sleeper',
  name: 'sleeper',
  layer: 'user',
  kind: 'mcp-stdio',
  state: 'required',
  plugin: null,
  stdio: {
    command: 'sleep',
    resolvedCommand: '/bin/sleep',
    args: ['127'],
    cwd: '/tmp/work',
    inheritEnv: false,
    env: [{ key: 'NODE_OPTIONS', sensitive: true, length: 12, risky: true }],
  },
  http: null,
  fingerprint: FINGERPRINT,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A service that serves `initial` details (until `serve` replaces them) and answers an approve with
 * `approveStatus`.
 */
function service(initial: McpLaunchApprovalDetails, approveStatus = 200) {
  let current = initial;
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ method, url: String(input), body, auth });
    if (method === 'GET') return json(200, current);
    if (approveStatus === 409)
      return json(409, { error: { code: 'approval_changed', message: 'It changed.' } });
    return json(approveStatus, {
      approval: {
        v: 1,
        kind: current.kind,
        serverId: current.serverId,
        layer: current.layer,
        fingerprint: current.fingerprint,
        approvedAt: '2026-09-29T00:00:00.000Z',
        via: 'electron',
      },
    });
  });
  const serve = (next: McpLaunchApprovalDetails) => {
    current = next;
  };
  return { calls, fetchImpl, serve };
}

function gate(fetchImpl: typeof fetch, extra: { busy?: boolean; now?: () => number } = {}) {
  return new McpApprovalGate({
    options: () => OPTIONS,
    dialogBusy: () => extra.busy ?? false,
    fetchImpl,
    now: extra.now,
  });
}

describe('McpApprovalGate', () => {
  it('approves only on Allow, with the fingerprint the dialog showed', async () => {
    const { calls, fetchImpl } = service(details);
    const confirm = vi.fn(async (_request: ConfirmRequest) => 1);
    await expect(gate(fetchImpl).request('sleeper', confirm)).resolves.toEqual({ approved: true });
    expect(confirm).toHaveBeenCalledOnce();
    const shown = confirm.mock.calls[0]![0];
    expect(shown.buttons).toEqual(['Cancel', 'Allow to Run']);
    expect([shown.defaultId, shown.cancelId]).toEqual([0, 0]);
    expect(shown.detail).toContain('Runs: "/bin/sleep"');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET http://127.0.0.1:4999/v1/admin/approvals/mcp/sleeper',
      'POST http://127.0.0.1:4999/v1/admin/approvals/mcp',
    ]);
    expect(calls[1]!.body).toEqual({
      serverId: 'sleeper',
      fingerprint: FINGERPRINT,
      via: 'electron',
    });
    expect(calls.every((call) => call.auth === 'Bearer main-token')).toBe(true);
  });

  it('never approves on Cancel, and refuses the same launch for a while without a dialog', async () => {
    const { calls, fetchImpl } = service(details);
    let time = 1000;
    const approvals = gate(fetchImpl, { now: () => time });
    const confirm = vi.fn(async () => 0);
    const cancelled = { approved: false, reason: 'cancelled' };
    await expect(approvals.request('sleeper', confirm)).resolves.toEqual(cancelled);
    await expect(approvals.request('sleeper', confirm)).resolves.toEqual(cancelled);
    expect(confirm).toHaveBeenCalledOnce();
    time += CANCEL_COOLDOWN_MS + 1;
    await approvals.request('sleeper', confirm);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('asks again at once when the launch changed after a Cancel', async () => {
    const { fetchImpl, serve } = service(details);
    const approvals = gate(fetchImpl, { now: () => 0 });
    await approvals.request('sleeper', async () => 0);
    serve({ ...details, fingerprint: 'b'.repeat(64) });
    const confirm = vi.fn(async () => 1);
    await expect(approvals.request('sleeper', confirm)).resolves.toEqual({ approved: true });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('answers changed when the service refuses the fingerprint', async () => {
    const { fetchImpl } = service(details, 409);
    await expect(gate(fetchImpl).request('sleeper', async () => 1)).resolves.toEqual({
      approved: false,
      reason: 'changed',
    });
  });

  it('answers busy while another dialog is open, and unavailable without a service', async () => {
    const { calls, fetchImpl } = service(details);
    const confirm = vi.fn(async () => 1);
    await expect(gate(fetchImpl, { busy: true }).request('sleeper', confirm)).resolves.toEqual({
      approved: false,
      reason: 'busy',
    });
    const offline = new McpApprovalGate({
      options: () => null,
      dialogBusy: () => false,
      fetchImpl,
    });
    await expect(offline.request('sleeper', confirm)).resolves.toEqual({
      approved: false,
      reason: 'unavailable',
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('answers busy for a second request while the first dialog is open', async () => {
    const { fetchImpl } = service(details);
    const approvals = gate(fetchImpl);
    let allow: (response: number) => void = () => undefined;
    const first = approvals.request('sleeper', () => new Promise((resolve) => (allow = resolve)));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await expect(approvals.request('sleeper', async () => 1)).resolves.toEqual({
      approved: false,
      reason: 'busy',
    });
    allow(1);
    await expect(first).resolves.toEqual({ approved: true });
  });

  it('skips the dialog for a server approved as it stands', async () => {
    const { calls, fetchImpl } = service({ ...details, state: 'approved' });
    const confirm = vi.fn(async () => 1);
    await expect(gate(fetchImpl).request('sleeper', confirm)).resolves.toEqual({ approved: true });
    expect(confirm).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });
});

describe('describeLaunch', () => {
  it('lists what runs with env keys and lengths, never values', () => {
    const text = describeLaunch(details);
    expect(text).toContain('This server runs a command on this computer.');
    expect(text).toContain('Environment: only the variables below');
    expect(text).toContain('Command: "sleep"');
    expect(text).toContain('Arguments: ["127"]');
    expect(text).toContain('Working directory: "/tmp/work"');
    expect(text).toContain(
      'Env "NODE_OPTIONS": 12 characters, hidden (changes what the runtime loads)',
    );
  });

  it('names a plugin server by its plugin and source, and an HTTP server by where it sends', () => {
    const text = describeLaunch({
      ...details,
      serverId: 'acme:search',
      name: 'search',
      layer: 'plugin',
      kind: 'mcp-http-env',
      stdio: null,
      plugin: {
        id: 'acme',
        name: 'Acme',
        version: '1.2.0',
        source: 'npm acme@1.2.0',
        revision: 'r1',
      },
      http: {
        url: 'https://mcp.example.com/mcp?team=${ACME_TEAM}',
        tokenEnv: 'ACME_TOKEN',
        headerKeys: ['X-Plain', 'X-Team'],
        urlReadsEnv: true,
        headers: [
          { key: 'X-Plain', readsEnv: false },
          { key: 'X-Team', readsEnv: true },
        ],
        envReferences: ['ACME_TEAM', 'ACME_TEAM_KEY'],
      },
    });
    expect(text).toContain('Plugin: "Acme" "1.2.0"');
    expect(text).toContain('Source: "npm acme@1.2.0"');
    expect(text).toContain(
      'URL: "https://mcp.example.com/mcp?team=${ACME_TEAM}" (reads service env vars)',
    );
    expect(text).toContain('Bearer token from service env var: "ACME_TOKEN"');
    expect(text).toContain('Header "X-Plain"\n');
    expect(text).toContain('Header "X-Team": reads service env vars');
    expect(text).toContain('Service env vars sent: ["ACME_TOKEN","ACME_TEAM","ACME_TEAM_KEY"]');
  });

  it('leaves out the token line when the token is not env-sourced', () => {
    const text = describeLaunch({
      ...details,
      kind: 'mcp-http-env',
      stdio: null,
      http: {
        url: 'https://mcp.example.com/mcp',
        tokenEnv: '',
        headerKeys: ['Authorization'],
        urlReadsEnv: false,
        headers: [{ key: 'Authorization', readsEnv: true }],
        envReferences: ['API_KEY'],
      },
    });
    expect(text).not.toContain('Bearer token');
    expect(text).toContain('Service env vars sent: ["API_KEY"]');
  });
});
