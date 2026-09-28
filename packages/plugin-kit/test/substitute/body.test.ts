import { describe, expect, it } from 'vitest';
import { substituteBody, type SubstitutionContext } from '../../src/substitute/index.js';

const context: SubstitutionContext = {
  root: '/revs/abc',
  data: '/data/demo',
  config: { REGION: 'eu', LIMIT: 5, API_KEY: 'sk-live' },
  sensitive: new Set(['API_KEY', 'UNSET_SECRET']),
  env: { HOME: '/home/me' },
};

describe('substituteBody', () => {
  it('expands Claude directories, skill dir and user config', () => {
    const body =
      'Run ${CLAUDE_PLUGIN_ROOT}/x in ${CLAUDE_SKILL_DIR}, store in ${CLAUDE_PLUGIN_DATA}; ' +
      'region ${user_config.REGION}, limit ${user_config.LIMIT}.';
    expect(substituteBody('claude', body, context, '/revs/abc/skills/demo')).toBe(
      'Run /revs/abc/x in /revs/abc/skills/demo, store in /data/demo; region eu, limit 5.',
    );
  });

  it('redacts sensitive keys whether or not they are set', () => {
    expect(
      substituteBody('claude', 'key=${user_config.API_KEY} ${user_config.UNSET_SECRET}', context),
    ).toBe('key=[redacted:API_KEY] [redacted:UNSET_SECRET]');
  });

  it('leaves missing keys, env references and a missing skill dir literal', () => {
    const body = '${user_config.MISSING} ${HOME} ${PLUGIN_ROOT} ${CLAUDE_SKILL_DIR}';
    expect(substituteBody('claude', body, context)).toBe(body);
  });

  it('does not expand text that an expansion produced', () => {
    const nested = { ...context, config: { REGION: '${CLAUDE_PLUGIN_ROOT}' } };
    expect(substituteBody('claude', '${user_config.REGION}', nested)).toBe('${CLAUDE_PLUGIN_ROOT}');
  });

  it.each(['agent-plugins', 'pi', 'skill'] as const)('returns %s bodies unchanged', (format) => {
    const body = '${CLAUDE_PLUGIN_ROOT} ${PLUGIN_ROOT} ${user_config.REGION}';
    expect(substituteBody(format, body, context, '/dir')).toBe(body);
  });
});
