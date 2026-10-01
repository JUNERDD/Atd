import { describe, expect, it } from 'vitest';
import type { McpTransport } from '../../src/model/manifest.js';
import {
  substituteTransport,
  transportSecrets,
  type SubstitutionContext,
} from '../../src/substitute/index.js';

const context: SubstitutionContext = {
  root: '/revs/abc',
  data: '/data/demo',
  config: { REGION: 'eu', API_KEY: 'sk-live' },
  sensitive: new Set(['API_KEY']),
  env: { SERVICE_TOKEN: 'env-secret', EMPTY: '' },
};

function http(headers: Record<string, string>, url = 'https://example.com/mcp'): McpTransport {
  return { type: 'http', protocol: 'streamable-http', url, headers };
}

function stdio(overrides: Partial<Extract<McpTransport, { type: 'stdio' }>> = {}): McpTransport {
  return { type: 'stdio', command: 'node', args: [], env: {}, ...overrides };
}

describe('transportSecrets', () => {
  it('names headers filled from sensitive config or the environment', () => {
    const transport = http({
      Authorization: 'Bearer ${user_config.API_KEY}',
      'X-Service': '${SERVICE_TOKEN}',
      'X-Region': '${user_config.REGION}',
      'X-Default': '${UNSET:-fallback}',
      'X-Empty': '${EMPTY}',
      'X-Root': '${CLAUDE_PLUGIN_ROOT}',
    });
    expect(transportSecrets('claude', transport, context)).toEqual({
      env: [],
      headers: ['Authorization', 'X-Service'],
      elsewhere: false,
    });
  });

  it('names env entries as substituted and flags secrets it cannot leave out', () => {
    const transport = stdio({
      env: { API: '${user_config.API_KEY}', PLAIN: 'x', DIR: '${CLAUDE_PLUGIN_DATA}/cache' },
    });
    const secrets = transportSecrets('claude', transport, context);
    expect(secrets).toEqual({ env: ['API'], headers: [], elsewhere: false });
    const substituted = substituteTransport('claude', transport, context).transport;
    expect(substituted.type === 'stdio' && substituted.env.API).toBe('sk-live');

    expect(
      transportSecrets('claude', stdio({ args: ['--key=${SERVICE_TOKEN}'] }), context),
    ).toMatchObject({ elsewhere: true });
    expect(
      transportSecrets('claude', http({}, 'https://x.test/?k=${user_config.API_KEY}'), context),
    ).toMatchObject({ elsewhere: true });
  });

  it('finds nothing in formats that never substitute secrets', () => {
    const transport = http({ Authorization: '${user_config.API_KEY}' });
    expect(transportSecrets('agent-plugins', transport, context)).toEqual({
      env: [],
      headers: [],
      elsewhere: false,
    });
  });
});
