import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { installBridge } from '../../../tests/app-test-bridge';
import type { TaskRun } from '../../client/agent/task-schema';
import type { Connection, ProviderCatalogEntry } from '../../client/providers/schema';
import { StatusBar } from '../agent/transcript/status-bar';
import { SettingsSubpageContext } from '../settings/settings-navigation';
import { ProviderConnections } from './provider-connections';
import { ProviderForm } from './provider-form';

afterEach(() => vi.unstubAllGlobals());

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

describe('provider credential issue UI', () => {
  it('shows warning status and notice instead of verified state on unreadable keychain rows', () => {
    installBridge();
    const row = connectionFixture({ credentialIssue: 'unreadable' });
    render(
      <ProviderConnections
        rows={[{ connection: row }]}
        defaultConnectionId={row.connectionId}
        pending={false}
        canManage
        onManage={vi.fn()}
        onConfirm={vi.fn()}
        perform={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByText('API key saved · Verified')).not.toBeInTheDocument();
    expect(screen.getByText('Credential unreadable · Re-enter key')).toBeInTheDocument();
    expect(
      screen.getByText(
        /saved API key cannot be read from the OS keychain \(common after an app update or signature change\)/i,
      ),
    ).toBeInTheDocument();
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
