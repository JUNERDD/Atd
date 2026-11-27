import { vi } from 'vitest';
import type {
  Connection,
  ModelAlias,
  ModelAliasDraft,
  ModelContexts,
  ModelLevels,
} from '../src/client/providers/schema';

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
    createAlias: vi.fn(async (draft: ModelAliasDraft): Promise<ModelAlias> => ({
      id: 'alias-1',
      ...draft,
    })),
    updateAlias: vi.fn(async (id: string, draft: ModelAliasDraft): Promise<ModelAlias> => ({
      id,
      ...draft,
    })),
    removeAlias: vi.fn(async () => {}),
    setDefaultAlias: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    remove: vi.fn(async () => undefined),
    refresh: vi.fn(async () => {}),
    refreshCatalogs: vi.fn(async () => {}),
    checkStatuses: vi.fn(async () => {}),
    verify: vi.fn(async () => {}),
    usage: vi.fn(async () => ({ kind: 'unsupported' as const })),
    login: vi.fn(async () => Promise.reject(new Error('Not used'))),
    answer: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    openLink: vi.fn(async () => {}),
    onLogin: () => () => {},
  };
}
