import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { installBridge } from '../../../tests/app-test-bridge';
import type { TaskRun } from '../../client/agent/task-schema';
import type { Connection, ProviderCatalogEntry } from '../../client/providers/schema';
import { queryClient } from '../../lib/query-client';
import { StatusBar } from '../agent/transcript/status-bar';
import { SettingsSubpageContext } from '../settings/settings-navigation';
import { ProviderConnections } from './provider-connections';
import { ProviderForm } from './provider-form';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => queryClient.clear());

function connectionFixture(overrides?: Partial<Connection>): Connection {
  return {
    connectionId: 'conn-1',
    revision: 2,
    provider: 'openai',
    name: 'OpenAI API',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'api_key',
    defaultModel: 'gpt-4.1',
    connected: true,
    hasCredential: true,
    options: {},
    customModels: [],
    catalog: [
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        api: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        reasoning: false,
        input: ['text'],
        contextWindow: 128000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    catalogError: '',
    verifiedModel: 'gpt-4.1',
    ...overrides,
  };
}

const catalogProviderFixture: ProviderCatalogEntry = {
  id: 'openai',
  name: 'OpenAI',
  category: 'api',
  auth: [{ type: 'api_key', label: 'API key' }],
  baseUrl: 'https://api.openai.com/v1',
  models: [],
};

const customProviderFixture: ProviderCatalogEntry = {
  id: 'openai-compatible',
  name: 'Custom provider',
  category: 'local',
  auth: [{ type: 'api_key', label: 'API key' }],
  baseUrl: '',
  models: [],
};

describe('provider credential issue UI', () => {
  it('shows warning status and notice instead of verified state on unreadable keychain rows', async () => {
    installBridge();
    const row = connectionFixture({ credentialIssue: 'unreadable' });
    render(
      <TooltipProvider>
        <ProviderConnections
          rows={[{ connection: row }]}
          defaultConnectionId={row.connectionId}
          pending={false}
          canManage
          onManage={vi.fn()}
          onConfirm={vi.fn()}
          perform={vi.fn(async () => {})}
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.getByText('Re-enter key')).toBeInTheDocument();
    await userEvent.hover(screen.getByRole('button', { name: 'Manage OpenAI API' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Credential unreadable · Re-enter key',
    );
    expect(
      screen.getByText(
        /saved API key cannot be read from the OS keychain \(common after an app update or signature change\)/i,
      ),
    ).toBeInTheDocument();
  });

  it('asks an OAuth credential issue to sign in again rather than re-enter a key', () => {
    installBridge();
    const row = connectionFixture({ authType: 'oauth', credentialIssue: 'unreadable' });
    render(
      <TooltipProvider>
        <ProviderConnections
          rows={[{ connection: row }]}
          defaultConnectionId={row.connectionId}
          pending={false}
          canManage
          onManage={vi.fn()}
          onConfirm={vi.fn()}
          perform={vi.fn(async () => {})}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText('Sign in again')).toBeInTheDocument();
    expect(screen.queryByText('Re-enter key')).not.toBeInTheDocument();
  });

  it('replaces keep-saved-key hints with re-entry guidance inside ProviderForm', () => {
    installBridge();
    const row = connectionFixture({ credentialIssue: 'unreadable' });
    render(
      <TooltipProvider>
        <SettingsSubpageContext value={() => () => {}}>
          <ProviderForm
            provider={catalogProviderFixture}
            connection={row}
            serviceName="OpenAI"
            planChoice={null}
            onSaved={vi.fn()}
            onBack={vi.fn()}
          />
        </SettingsSubpageContext>
      </TooltipProvider>,
    );

    expect(
      screen.getByText(
        /previously saved API key cannot be read from the OS keychain \(commonly after an app update/i,
      ),
    ).toBeInTheDocument();
    const input = screen.getByLabelText('API key');
    expect(input).toHaveAttribute('placeholder', 'Saved key unreadable — enter API key');
    expect(
      screen.queryByPlaceholderText('Leave unchanged to keep the saved key'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Saving a new key restores access while keeping your endpoint and model configuration.',
      ),
    ).toBeInTheDocument();
  });

  it('offers an explicit opt-in before usage queries use a plain-HTTP endpoint', async () => {
    installBridge();
    const user = userEvent.setup();
    const row = connectionFixture({ baseUrl: 'http://api.example.com/v1' });
    render(
      <TooltipProvider>
        <SettingsSubpageContext value={() => () => {}}>
          <ProviderForm
            provider={catalogProviderFixture}
            connection={row}
            serviceName="OpenAI"
            planChoice={null}
            onSaved={vi.fn()}
            onBack={vi.fn()}
          />
        </SettingsSubpageContext>
      </TooltipProvider>,
    );

    await user.click(screen.getByRole('button', { name: /advanced settings/i }));
    const toggle = screen.getByRole('switch', {
      name: /allow usage queries over plain http/i,
    });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
  });

  it('clears hidden allowInsecureUsage and resets dirty state when restoring a saved HTTPS endpoint', async () => {
    installBridge();
    const user = userEvent.setup();
    const row = connectionFixture({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
    });
    render(
      <TooltipProvider>
        <SettingsSubpageContext value={() => () => {}}>
          <ProviderForm
            provider={customProviderFixture}
            connection={row}
            serviceName="Custom provider"
            planChoice={null}
            onSaved={vi.fn()}
            onBack={vi.fn()}
          />
        </SettingsSubpageContext>
      </TooltipProvider>,
    );

    const refreshButton = screen.getByRole('button', { name: 'Refresh models' });
    const verifyButton = screen.getByRole('button', { name: 'Verify model access' });
    expect(refreshButton).not.toHaveAttribute('aria-disabled');
    expect(verifyButton).not.toHaveAttribute('aria-disabled');

    await user.click(screen.getByRole('button', { name: /advanced settings/i }));
    const endpointInput = screen.getByLabelText('Base URL');

    fireEvent.change(endpointInput, { target: { value: 'http://api.example.com/v1' } });
    const toggle = screen.getByRole('switch', {
      name: /allow usage queries over plain http/i,
    });
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(refreshButton).toHaveAttribute('aria-disabled', 'true');
    expect(verifyButton).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText('Save changes to refresh usage for the new credential.'),
    ).toBeInTheDocument();

    fireEvent.change(endpointInput, { target: { value: 'https://api.example.com/v1' } });
    expect(
      screen.queryByRole('switch', { name: /allow usage queries over plain http/i }),
    ).not.toBeInTheDocument();
    expect(refreshButton).not.toHaveAttribute('aria-disabled');
    expect(verifyButton).not.toHaveAttribute('aria-disabled');
    expect(
      screen.queryByText('Save changes to refresh usage for the new credential.'),
    ).not.toBeInTheDocument();

    fireEvent.change(endpointInput, { target: { value: 'http://api.example.com/v1' } });
    expect(
      screen.getByRole('switch', { name: /allow usage queries over plain http/i }),
    ).not.toBeChecked();
  });

  it('resets allowInsecureUsage when changing plain-HTTP hosts and restores it on saved URL revert', async () => {
    installBridge();
    const user = userEvent.setup();
    const row = connectionFixture({
      provider: 'openai-compatible',
      baseUrl: 'http://host-a.example/v1',
      allowInsecureUsage: true,
    });
    render(
      <TooltipProvider>
        <SettingsSubpageContext value={() => () => {}}>
          <ProviderForm
            provider={customProviderFixture}
            connection={row}
            serviceName="Custom provider"
            planChoice={null}
            onSaved={vi.fn()}
            onBack={vi.fn()}
          />
        </SettingsSubpageContext>
      </TooltipProvider>,
    );

    const refreshButton = screen.getByRole('button', { name: 'Refresh models' });
    await user.click(screen.getByRole('button', { name: /advanced settings/i }));
    const endpointInput = screen.getByLabelText('Base URL');
    const toggle = screen.getByRole('switch', {
      name: /allow usage queries over plain http/i,
    });
    expect(toggle).toBeChecked();
    expect(refreshButton).not.toHaveAttribute('aria-disabled');

    fireEvent.change(endpointInput, { target: { value: 'http://host-b.example/v1' } });
    expect(toggle).not.toBeChecked();
    expect(refreshButton).toHaveAttribute('aria-disabled', 'true');

    fireEvent.change(endpointInput, { target: { value: 'http://host-a.example/v1' } });
    expect(toggle).toBeChecked();
    expect(refreshButton).not.toHaveAttribute('aria-disabled');
  });

  it('renders a localized credential recovery banner and settings shortcut in StatusBar', async () => {
    installBridge();
    const openSection = vi.spyOn(window.desktop!.settings, 'openSection').mockResolvedValue();
    const user = userEvent.setup();
    const failedRun = {
      id: 'run-1',
      taskId: 'task-1',
      rootTaskId: 'task-1',
      status: 'failed',
      error:
        'auth_required: OpenAI API credentials in the OS keychain could not be read (ACL mismatch). Reconnect it in Settings → Providers, then send again. [credential_unreadable]',
    } as unknown as TaskRun;

    render(<StatusBar run={failedRun} />);

    expect(
      screen.getByText(
        /saved credentials for this provider could not be read from the OS keychain/i,
      ),
    ).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Open provider settings' });
    await user.click(button);
    expect(openSection).toHaveBeenCalledWith('providers');
  });
});
