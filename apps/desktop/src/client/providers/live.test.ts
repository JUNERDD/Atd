import type { ServiceConnection } from '@atd/agent-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveProviders, saveLive, toDesktopConnection } from './live';
import type { ConnectionDraft } from './schema';

const CLIENT_OPTIONS = { baseUrl: 'http://127.0.0.1:4312', token: 'test-token' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function serviceConnectionFixture(overrides?: Partial<ServiceConnection>): ServiceConnection {
  return {
    connectionId: 'conn-1',
    provider: 'openai-compatible',
    name: 'Private gateway',
    baseUrl: 'http://gateway.example/v1',
    authType: 'api_key',
    defaultModel: 'gpt-4.1',
    revision: 1,
    connected: true,
    hasCredential: true,
    configurationId: 'cfg-1',
    verifiedModel: '',
    migratedAt: null,
    options: {},
    customModels: [],
    catalog: [],
    catalogError: '',
    ...overrides,
  };
}

function draftFixture(overrides?: Partial<ConnectionDraft>): ConnectionDraft {
  return {
    connectionId: null,
    expectedRevision: null,
    provider: 'openai-compatible',
    name: 'Private gateway',
    baseUrl: 'http://gateway.example/v1',
    authType: 'api_key',
    defaultModel: 'gpt-4.1',
    allowInsecureUsage: false,
    options: {},
    customModels: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function parseJsonBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe('live provider client allowInsecureUsage persistence', () => {
  it('hydrates allowInsecureUsage on readback only when enabled', () => {
    const enabled = toDesktopConnection(serviceConnectionFixture({ allowInsecureUsage: true }));
    const disabled = toDesktopConnection(serviceConnectionFixture({ allowInsecureUsage: false }));
    const omitted = toDesktopConnection(serviceConnectionFixture());

    expect(enabled.allowInsecureUsage).toBe(true);
    expect(disabled.allowInsecureUsage).toBeUndefined();
    expect(omitted.allowInsecureUsage).toBeUndefined();
  });

  it('hydrates allowInsecureUsage when listing live providers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          defaultConnectionId: 'conn-1',
          defaultAliasId: null,
          connections: [serviceConnectionFixture({ allowInsecureUsage: true })],
          aliases: [],
        }),
      ),
    );

    const snapshot = await fetchLiveProviders(CLIENT_OPTIONS);
    expect(snapshot.connections[0]?.allowInsecureUsage).toBe(true);
  });

  it('sends allowInsecureUsage: true on create for plain HTTP and omits it for HTTPS and loopback', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = parseJsonBody(init);
        bodies.push(body);
        return jsonResponse({
          connection: serviceConnectionFixture({
            baseUrl: String(body['baseUrl']),
            ...(body['allowInsecureUsage'] === true ? { allowInsecureUsage: true } : {}),
          }),
          readable: true,
          modelCheck: 'unchecked',
        });
      }),
    );

    const plainHttp = await saveLive(
      CLIENT_OPTIONS,
      draftFixture({
        baseUrl: 'http://gateway.example/v1/',
        allowInsecureUsage: true,
        apiKey: 'sk-test',
      }),
    );
    const https = await saveLive(
      CLIENT_OPTIONS,
      draftFixture({
        baseUrl: 'https://gateway.example/v1',
        allowInsecureUsage: true,
        apiKey: 'sk-test',
      }),
    );
    const loopback = await saveLive(
      CLIENT_OPTIONS,
      draftFixture({
        baseUrl: 'http://127.0.0.1:8080/v1',
        allowInsecureUsage: true,
        apiKey: 'sk-test',
      }),
    );

    expect(bodies[0]?.['allowInsecureUsage']).toBe(true);
    expect(plainHttp.allowInsecureUsage).toBe(true);
    expect(bodies[1]).not.toHaveProperty('allowInsecureUsage');
    expect(https.allowInsecureUsage).toBeUndefined();
    expect(bodies[2]).not.toHaveProperty('allowInsecureUsage');
    expect(loopback.allowInsecureUsage).toBeUndefined();
  });

  it('sends explicit allowInsecureUsage booleans on update when enabling, disabling, or switching to HTTPS', async () => {
    const putBodies: Array<Record<string, unknown>> = [];
    let stored = serviceConnectionFixture({ revision: 2 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return jsonResponse({ connection: stored });
        }
        const body = parseJsonBody(init);
        putBodies.push(body);
        const next: ServiceConnection = {
          ...stored,
          baseUrl: String(body['baseUrl']),
          revision: stored.revision + 1,
        };
        if (body['allowInsecureUsage'] === true) next.allowInsecureUsage = true;
        else delete next.allowInsecureUsage;
        stored = next;
        return jsonResponse({ connection: stored });
      }),
    );

    const enabled = await saveLive(
      CLIENT_OPTIONS,
      draftFixture({
        connectionId: 'conn-1',
        expectedRevision: 2,
        baseUrl: 'http://gateway.example/v1',
        allowInsecureUsage: true,
      }),
    );
    expect(putBodies[0]?.['allowInsecureUsage']).toBe(true);
    expect(enabled.allowInsecureUsage).toBe(true);

    const disabled = await saveLive(
      CLIENT_OPTIONS,
      draftFixture({
        connectionId: 'conn-1',
        expectedRevision: enabled.revision,
        baseUrl: 'http://gateway.example/v1',
        allowInsecureUsage: false,
      }),
    );
    expect(putBodies[1]?.['allowInsecureUsage']).toBe(false);
    expect(disabled.allowInsecureUsage).toBeUndefined();

    const switchedToHttps = await saveLive(
      CLIENT_OPTIONS,
      draftFixture({
        connectionId: 'conn-1',
        expectedRevision: disabled.revision,
        baseUrl: 'https://gateway.example/v1',
        allowInsecureUsage: true,
      }),
    );
    expect(putBodies[2]?.['allowInsecureUsage']).toBe(false);
    expect(switchedToHttps.allowInsecureUsage).toBeUndefined();
  });
});
