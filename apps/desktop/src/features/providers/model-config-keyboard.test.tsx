import type { ModelAlias } from '@atd/agent-contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import type { Connection, ModelContexts, ModelLevels } from '../../client/providers/schema';
import type { ServiceStatusView } from '../../client/service/ipc';
import { bridgeKeys } from '../../lib/bridge-cache';
import { queryClient } from '../../lib/query-client';
import { ModelConfigPopover } from './model-config-popover';

const CONNECTED: ServiceStatusView = {
  state: 'connected',
  detail: '',
  serviceId: 'test',
  epoch: 1,
  draining: false,
  activeRuns: 0,
  pendingConfirms: 0,
  pendingCapabilities: 0,
  dataDir: null,
  baseUrl: null,
  stream: { epoch: 1, seq: 0 },
};

const TIERED_CONTEXTS: ModelContexts = {
  options: [
    { tier: 'standard', contextWindow: 128000, pricedAbove: null },
    { tier: 'long', contextWindow: 1000000, pricedAbove: 128000 },
  ],
  defaultTier: 'standard',
  selected: 'standard',
  catalogWindow: 128000,
  choices: [],
  custom: null,
};

function makeConnection(id: string, name: string, connected = true): Connection {
  return {
    connectionId: id,
    revision: 1,
    provider: 'openai',
    name,
    baseUrl: 'https://api.openai.com/v1',
    authType: 'api_key',
    defaultModel: 'model-a',
    connected,
    hasCredential: connected,
    options: {},
    customModels: [],
    catalog: [
      {
        id: 'model-a',
        name: 'Model A',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: true,
        input: ['text'],
        contextWindow: 128000,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    catalogError: '',
    verifiedModel: connected ? 'model-a' : '',
  };
}

const ALIASES: ModelAlias[] = [
  { id: 'alias-daily', name: 'Daily', connectionId: 'conn-1', modelId: 'model-a' },
  { id: 'alias-offline', name: 'OfflineAlias', connectionId: 'conn-offline', modelId: 'model-a' },
  {
    id: 'alias-deep',
    name: 'Deep',
    connectionId: 'conn-1',
    modelId: 'model-a',
    thinkingLevel: 'high',
  },
];

async function renderPopover(options?: {
  aliases?: ModelAlias[];
  activeAliasId?: string | null;
  aliasModified?: boolean;
  levels?: ModelLevels;
}) {
  installBridge();
  queryClient.setQueryData(bridgeKeys.serviceStatus, CONNECTED);
  const providers = window.desktop!.settings.providers;
  vi.mocked(providers.contexts).mockResolvedValue(TIERED_CONTEXTS);
  if (options?.levels) vi.mocked(providers.levels).mockResolvedValue(options.levels);
  const onSelectAlias = vi.fn();

  render(
    <ModelConfigPopover
      connections={[
        makeConnection('conn-1', 'Primary'),
        makeConnection('conn-offline', 'Down', false),
      ]}
      model={{ connectionId: 'conn-1', modelId: 'model-a' }}
      thinkingLevel={undefined}
      onThinkingLevelChange={vi.fn()}
      onModelChange={vi.fn()}
      aliases={options?.aliases}
      activeAliasId={options?.activeAliasId}
      aliasModified={options?.aliasModified}
      onSelectAlias={onSelectAlias}
      onRestoreAlias={vi.fn()}
      onSaveAsAlias={vi.fn(async () => {})}
    />,
  );

  const trigger = screen.getByRole('button', { name: /Model A.*128k/ });
  await waitFor(() => expect(trigger).toHaveAccessibleName(/Off/));
  await waitFor(() => expect(providers.contexts).toHaveBeenCalled());
  return { trigger, onSelectAlias };
}

const scope = () => within(screen.getByRole('dialog'));
const btn = (name: RegExp | string) => scope().getByRole('button', { name });
const waitFocused = (name: RegExp | string) => waitFor(() => expect(btn(name)).toHaveFocus());

describe('ModelConfigPopover keyboard navigation', () => {
  it('cycles root items with wrap-around, skips disabled items, and selects aliases with Enter', async () => {
    const user = userEvent.setup();
    const { trigger, onSelectAlias } = await renderPopover({
      aliases: ALIASES,
      activeAliasId: 'alias-daily',
      aliasModified: true,
    });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(btn(/^OfflineAlias/)).toBeDisabled();

    const expectedOrder = [
      btn(/^Daily/),
      btn(/^Deep/),
      btn(/^Restore/),
      btn('Save as new alias'),
      btn(/^Context/),
      btn(/^Effort/),
      btn(/^Model/),
    ];

    for (const item of expectedOrder) {
      await user.keyboard('{ArrowDown}');
      expect(item).toHaveFocus();
    }
    await user.keyboard('{ArrowDown}');
    expect(expectedOrder[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(expectedOrder.at(-1)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(expectedOrder[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(expectedOrder.at(-1)).toHaveFocus();

    await user.keyboard('{Home}{Enter}');
    expect(onSelectAlias).toHaveBeenCalledWith(ALIASES[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('skips Effort when effortDisabled is true', async () => {
    const user = userEvent.setup();
    const { trigger } = await renderPopover({ levels: { levels: ['off'], defaultLevel: 'off' } });

    await user.click(trigger);
    const contextRow = btn(/^Context/);
    const modelRow = btn(/^Model/);
    expect(btn(/^Effort/)).toBeDisabled();

    await user.keyboard('{ArrowDown}');
    expect(contextRow).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(modelRow).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(contextRow).toHaveFocus();
  });

  it('opens on ArrowDown, ArrowUp, and Enter from the trigger and focuses the edge item', async () => {
    const user = userEvent.setup();
    const { trigger } = await renderPopover({ aliases: ALIASES });

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await waitFocused(/^Daily/);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.keyboard('{ArrowUp}');
    await waitFocused(/^Model/);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.keyboard('{Enter}');
    await waitFocused(/^Daily/);
  });

  it('drills with ArrowRight and returns with ArrowLeft while keeping search ArrowLeft editing', async () => {
    const user = userEvent.setup();
    const { trigger } = await renderPopover();

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await waitFocused(/^Context/);

    await user.keyboard('{ArrowRight}');
    const standardOption = await scope().findByRole('button', { name: /Standard/ });
    await waitFor(() => expect(standardOption).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    await waitFocused(/^Context/);

    await user.keyboard('{ArrowDown}');
    expect(btn(/^Effort/)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const offOption = await scope().findByRole('button', { name: 'Off' });
    await waitFor(() => expect(offOption).toHaveFocus());
    await user.keyboard('{ArrowLeft}');
    await waitFocused(/^Effort/);

    await user.keyboard('{ArrowDown}');
    expect(btn(/^Model/)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    const search = await scope().findByRole('combobox');
    await waitFor(() => expect(search).toHaveFocus());

    await user.type(search, 'Model');
    await user.keyboard('{ArrowLeft}');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('Model');

    await user.clear(search);
    await user.keyboard('{ArrowLeft}');
    await waitFocused(/^Model/);
  });

  it('closes only the inline Save-as-new form on Escape and restores focus to Save as new alias', async () => {
    const user = userEvent.setup();
    const { trigger } = await renderPopover({
      aliases: ALIASES,
      activeAliasId: 'alias-daily',
      aliasModified: true,
    });

    await user.click(trigger);
    await user.click(btn('Save as new alias'));
    const input = await scope().findByLabelText('New alias name');
    await waitFor(() => expect(input).toHaveFocus());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(scope().queryByLabelText('New alias name')).not.toBeInTheDocument());
    await waitFocused('Save as new alias');

    await user.keyboard('{ArrowDown}');
    expect(btn(/^Context/)).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(btn('Save as new alias')).toHaveFocus();
  });
});
