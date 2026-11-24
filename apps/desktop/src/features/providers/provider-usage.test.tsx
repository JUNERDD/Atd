import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import type { Connection } from '../../client/providers/schema';
import { queryClient } from '../../lib/query-client';
import { ProviderUsageSummary } from './provider-usage';
import { soonestReset } from './provider-usage-format';
import { ProviderUsagePanel } from './provider-usage-panel';
import { useProviderUsage } from './use-provider-usage';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => queryClient.clear());

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

describe('provider usage panel', () => {
  it('shows every allowance window in the row pill', async () => {
    installBridge();
    window.desktop!.settings.providers.usage = vi.fn(async () => ({
      kind: 'ok' as const,
      windows: [
        { id: 'session' as const, usedRatio: 0.51 },
        { id: 'weekly' as const, usedRatio: 0.32 },
      ],
    }));

    render(<ProviderUsageSummary connection={connectionFixture()} />);

    expect(await screen.findByText('Session 51% · Weekly 32%')).toBeInTheDocument();
  });

  it('shows the reported windows, reset time, and balance', async () => {
    installBridge();
    window.desktop!.settings.providers.usage = vi.fn(async () => ({
      kind: 'ok' as const,
      windows: [
        {
          id: 'session' as const,
          usedRatio: 0.055,
          resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
        { id: 'weekly' as const, usedRatio: 0.1934 },
      ],
      balance: { currency: 'USD', remaining: 12.5, total: 20 },
    }));

    render(<ProviderUsagePanel connection={connectionFixture()} />);

    expect(await screen.findByText('Session (5 hours)')).toBeInTheDocument();
    expect(screen.getByText('6%')).toBeInTheDocument();
    expect(screen.getByText('19%')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText('Resets in 1 hour')).toBeInTheDocument();
  });

  it('names a provider without a usage API instead of leaving the section blank', async () => {
    installBridge();
    window.desktop!.settings.providers.usage = vi.fn(async () => ({
      kind: 'unsupported' as const,
    }));

    render(<ProviderUsagePanel connection={connectionFixture({ provider: 'zai' })} />);

    expect(await screen.findByText(/does not publish plan usage/i)).toBeInTheDocument();
  });

  it('does not draw a divider above a balance-only card', async () => {
    installBridge();
    window.desktop!.settings.providers.usage = vi.fn(async () => ({
      kind: 'ok' as const,
      windows: [],
      balance: { currency: 'USD', remaining: 12 },
    }));

    render(<ProviderUsagePanel connection={connectionFixture()} />);

    expect(await screen.findByText('$12.00')).toBeInTheDocument();
    const balance = document.querySelector('[data-slot="usage-balance"]');
    expect(balance).toHaveAttribute('data-separated', 'false');
    expect(balance).not.toHaveClass('border-t');
  });

  it('keeps the last windows and names a failed refresh once', async () => {
    installBridge();
    const usage = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'ok' as const,
        windows: [{ id: 'session' as const, usedRatio: 0.25 }],
      })
      .mockResolvedValueOnce({ kind: 'error' as const, message: 'network down' });
    window.desktop!.settings.providers.usage = usage;

    render(<ProviderUsagePanel connection={connectionFixture()} />);
    expect(await screen.findByText('Session (5 hours)')).toBeInTheDocument();
    expect(screen.queryByText('Usage is unavailable right now.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByText("Couldn't refresh usage. Showing the last result."),
    ).toBeInTheDocument();
    expect(screen.getByText('Session (5 hours)')).toBeInTheDocument();
    expect(screen.queryByText('Usage is unavailable right now.')).not.toBeInTheDocument();
    expect(usage).toHaveBeenLastCalledWith('kimi-1', true);
  });

  it('names ChatGPT OAuth as unsupported instead of calling the retired Codex endpoint', async () => {
    installBridge();
    const usage = vi.fn(async () => ({ kind: 'unsupported' as const }));
    window.desktop!.settings.providers.usage = usage;

    render(
      <ProviderUsagePanel
        connection={connectionFixture({
          provider: 'openai',
          authType: 'oauth',
        })}
      />,
    );

    expect(await screen.findByText(/does not publish plan usage/i)).toBeInTheDocument();
    expect(usage).toHaveBeenCalledWith('kimi-1', false);
  });

  it('does not read usage automatically while the status probe is gated', () => {
    installBridge();
    const usage = vi.fn(async () => ({ kind: 'ok' as const, windows: [] }));
    window.desktop!.settings.providers.usage = usage;

    render(<ProviderUsageSummary connection={connectionFixture()} enabled={false} />);

    expect(usage).not.toHaveBeenCalled();
  });

  it('skips elapsed and invalid resets when picking the soonest one', () => {
    const now = Date.now();
    expect(
      soonestReset([
        { id: 'session', usedRatio: 0.1, resetsAt: new Date(now - 60_000).toISOString() },
        { id: 'weekly', usedRatio: 0.2, resetsAt: 'not-a-date' },
        { id: 'monthly', usedRatio: 0.3, resetsAt: new Date(now + 3_600_000).toISOString() },
      ])?.id,
    ).toBe('monthly');
  });
});

function UsageProbe({ connection }: { connection: Connection }) {
  const { data } = useProviderUsage(connection);
  return <span>{data?.kind ?? 'pending'}</span>;
}

describe('provider usage query', () => {
  it('refetches after the connection revision changes', async () => {
    installBridge();
    const usage = vi.fn(async () => ({ kind: 'ok' as const, windows: [] }));
    window.desktop!.settings.providers.usage = usage;
    const connection = connectionFixture({ connectionId: 'revision-probe' });

    const { rerender } = render(<UsageProbe connection={connection} />);
    expect(await screen.findByText('ok')).toBeInTheDocument();

    rerender(<UsageProbe connection={{ ...connection, revision: connection.revision + 1 }} />);

    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));
  });
});
