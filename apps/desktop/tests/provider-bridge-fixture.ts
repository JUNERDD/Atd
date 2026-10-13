import { vi } from 'vitest';
import type { Connection, ModelContexts, ModelLevels } from '../src/client/providers/schema';

/**
 * The provider bridge the test windows use: three effort levels, no context choice (an unknown
 * catalog window), and writes that only record their calls. A save answers `saved()`.
 */
export function providerBridgeFixture(saved: () => Connection) {
  return {
    catalog: vi.fn(async () => []),
    save: vi.fn(async () => saved()),
    setDefault: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    levels: vi.fn(async (): Promise<ModelLevels> => ({
      levels: ['off', 'low', 'high'],
      defaultLevel: 'off',
    })),
    contexts: vi.fn(async (): Promise<ModelContexts> => ({
      options: [],
      defaultTier: null,
      selected: null,
      catalogWindow: null,
      custom: null,
      choices: [],
    })),
    setContext: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    remove: vi.fn(async () => undefined),
    refresh: vi.fn(async () => {}),
    refreshCatalogs: vi.fn(async () => {}),
    verify: vi.fn(async () => {}),
    login: vi.fn(async () => Promise.reject(new Error('Not used'))),
    answer: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    openLink: vi.fn(async () => {}),
    onLogin: () => () => {},
  };
}
