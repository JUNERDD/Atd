import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import { initialTestSettings } from '../../../tests/app-test-settings';
import type { Connection } from '../../client/providers/schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { bridgeKeys } from '../../lib/bridge-cache';
import { queryClient } from '../../lib/query-client';
import { ChatGPTSettings } from './chatgpt-settings';
import { ProviderUsageDialog, ProviderUsageSummary } from './provider-usage';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => queryClient.clear());

function installSettingsBridge(patch?: Partial<SettingsSnapshot>) {
  installBridge();
  const snapshot: SettingsSnapshot = { ...initialTestSettings(), ...patch };
  window.desktop!.settings.get = vi.fn(async () => snapshot);
  return snapshot;
}

function connectionFixture(overrides?: Partial<Connection>): Connection {
  return {
    connectionId: 'kimi-1',
    revision: 1,
    provider: 'kimi-coding',
    name: 'Kimi Code · 国内',
    baseUrl: 'https://api.kimi.com/coding/v1',
    authType: 'api_key',
    defaultModel: 'kimi-for-coding',
    connected: true,
    hasCredential: true,
    options: {},
    customModels: [],
    catalog: [],
    catalogError: '',
    verifiedModel: 'kimi-for-coding',
    ...overrides,
  };
}

describe('ProviderUsageDialog layout and keychain gate', () => {
  it('wraps usage content in a bounded panel-dialog ScrollArea while keeping footer actions outside', async () => {
    const onClose = vi.fn();
    installSettingsBridge();
    window.desktop!.settings.providers.usage = vi.fn(async () => ({
      kind: 'ok' as const,
      windows: [
        { id: 'session' as const, usedRatio: 0.4 },
        { id: 'weekly' as const, usedRatio: 0.5 },
        { id: 'monthly' as const, usedRatio: 0.6 },
        { id: 'monthlyCode' as const, usedRatio: 0.7 },
      ],
      balance: { currency: 'USD', remaining: 12.5, total: 20 },
    }));

    render(<ProviderUsageDialog connection={connectionFixture()} onClose={onClose} />);

    expect(await screen.findByText('Monthly code')).toBeInTheDocument();
    const content = document.querySelector('[data-slot="dialog-content"]');
    const scrollArea = content?.querySelector('[data-slot="scroll-area"]');
    const viewport = content?.querySelector('[data-slot="scroll-area-viewport"]');
    const footer = content?.querySelector('[data-slot="dialog-footer"]');

    expect(content).toHaveClass('panel-dialog');
    expect(viewport).toBeInTheDocument();
    expect(viewport).toContainElement(screen.getByText('Monthly code'));
    expect(footer).toBeInTheDocument();
    expect(scrollArea).not.toContainElement(footer as HTMLElement);

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    const doneButton = screen.getByRole('button', { name: 'Done' });
    expect(footer).toContainElement(refreshButton);
    expect(footer).toContainElement(doneButton);

    fireEvent.click(doneButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pauses automatic reads in ProviderUsageDialog while gated and lets manual Refresh run', async () => {
    const healthy = connectionFixture();
    installSettingsBridge({ providerStatusesChecked: false, connections: [healthy] });
    const usage = vi.fn(async () => ({
      kind: 'error' as const,
      message: 'x'.repeat(2000),
    }));
    window.desktop!.settings.providers.usage = usage;

    render(<ProviderUsageDialog connection={healthy} onClose={vi.fn()} />);

    expect(
      await screen.findByText(/automatic usage checks are paused until credential access/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading usage…')).not.toBeInTheDocument();
    expect(usage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Usage is unavailable right now.')).toBeInTheDocument();
    expect(usage).toHaveBeenCalledWith(healthy.connectionId, true);
    const viewport = document.querySelector('[data-slot="scroll-area-viewport"]');
    expect(viewport).toContainElement(screen.getByText('Error details'));
  });

  it('hides cached ProviderUsageSummary data once a sibling becomes unreadable', async () => {
    const healthy = connectionFixture();
    const initial = installSettingsBridge({
      providerStatusesChecked: true,
      connections: [healthy],
    });
    window.desktop!.settings.providers.usage = vi.fn(async () => ({
      kind: 'ok' as const,
      windows: [{ id: 'session' as const, usedRatio: 0.51 }],
    }));

    render(<ProviderUsageSummary connection={healthy} />);
    expect(await screen.findByText('Session 51%')).toBeInTheDocument();

    queryClient.setQueryData<SettingsSnapshot>(bridgeKeys.settings, {
      ...initial,
      connections: [
        healthy,
        connectionFixture({ connectionId: 'sibling-1', credentialIssue: 'unreadable' }),
      ],
    });

    await waitFor(() => expect(screen.queryByText('Session 51%')).not.toBeInTheDocument());
  });

  it('handles ChatGPT OAuth enabled, plan-disabled, and unreadable states in ProviderUsageDialog', () => {
    installSettingsBridge();
    const usage = vi.fn(async () => ({ kind: 'unsupported' as const }));
    const openLink = vi.spyOn(window.desktop!.agent, 'openLink').mockResolvedValue();
    window.desktop!.settings.providers.usage = usage;

    const enabled = render(
      <ProviderUsageDialog
        connection={connectionFixture({
          provider: 'openai',
          authType: 'oauth',
          chatgptPlanEnabled: true,
        })}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/ChatGPT plan usage is managed in ChatGPT settings/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage usage' }));
    expect(openLink).toHaveBeenCalledWith('https://chatgpt.com/settings/usage');
    expect(usage).not.toHaveBeenCalled();
    enabled.unmount();

    const planDisabled = render(
      <ProviderUsageDialog
        connection={connectionFixture({
          provider: 'openai',
          authType: 'oauth',
          chatgptPlanEnabled: false,
        })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/plan usage is not enabled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage usage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(usage).not.toHaveBeenCalled();
    planDisabled.unmount();

    render(
      <ProviderUsageDialog
        connection={connectionFixture({
          provider: 'openai',
          authType: 'oauth',
          chatgptPlanEnabled: true,
          credentialIssue: 'unreadable',
        })}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/saved credentials cannot be read from the OS keychain/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage usage' })).not.toBeInTheDocument();
    expect(usage).not.toHaveBeenCalled();
  });

  it('shows workplace vs plan limit guidance in ChatGPTSettings from chatgptUsagePauseReason', () => {
    installBridge();
    const saved = connectionFixture({
      provider: 'openai',
      authType: 'oauth',
      chatgptUsagePaused: true,
      chatgptUsagePauseReason: 'subscription_sharing_workplace_individual_usage_limit_exceeded',
    });
    const draft = {
      connectionId: saved.connectionId,
      expectedRevision: saved.revision,
      provider: saved.provider,
      name: saved.name,
      baseUrl: saved.baseUrl,
      authType: saved.authType,
      defaultModel: saved.defaultModel,
      options: {},
      customModels: [],
    };
    const first = render(
      <ChatGPTSettings
        draft={draft}
        saved={saved}
        disabled={false}
        onConsent={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/individual usage limit for this ChatGPT Business workspace/i),
    ).toBeInTheDocument();
    first.unmount();

    render(
      <ChatGPTSettings
        draft={draft}
        saved={{ ...saved, chatgptUsagePauseReason: 'subscription_sharing_usage_limit_exceeded' }}
        disabled={false}
        onConsent={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/ChatGPT plan or Atd’s app allowance has reached a limit/i),
    ).toBeInTheDocument();
  });
});
