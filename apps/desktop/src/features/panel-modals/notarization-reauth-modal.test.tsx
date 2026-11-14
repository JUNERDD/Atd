import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '@atd/ui/components/dialog';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { ServiceBridge } from '../../client/service/ipc';
import { installBridge } from '../../../tests/app-test-bridge';
import { NotarizationReauthModal } from './notarization-reauth-modal';

type ProviderConnection = SettingsSnapshot['connections'][number];

function renderModal(props: ComponentProps<typeof NotarizationReauthModal>) {
  const rendered = render(
    <Dialog open>
      <NotarizationReauthModal {...props} />
    </Dialog>,
  );
  return {
    ...rendered,
    rerenderModal: (nextProps: ComponentProps<typeof NotarizationReauthModal>) =>
      rendered.rerender(
        <Dialog open>
          <NotarizationReauthModal {...nextProps} />
        </Dialog>,
      ),
  };
}

function connectionFixture(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    connectionId: 'conn-1',
    revision: 1,
    provider: 'openai',
    name: 'OpenAI API',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'api_key',
    defaultModel: 'gpt-5',
    connected: true,
    hasCredential: true,
    options: {},
    customModels: [],
    catalog: [],
    catalogError: '',
    verifiedModel: 'gpt-5',
    ...overrides,
  };
}

async function snapshotFixture(
  overrides: Partial<SettingsSnapshot> = {},
): Promise<SettingsSnapshot> {
  const base = await window.desktop!.settings.get();
  return {
    ...base,
    accessibilityTrusted: false,
    screenRecordingTrusted: false,
    connections: [connectionFixture()],
    ...overrides,
  };
}

describe('NotarizationReauthModal', () => {
  it('renders the third Model credentials row and opens Settings › Providers when clicked', async () => {
    installBridge();
    const snapshot = await snapshotFixture();

    renderModal({
      snapshot,
      onDismiss: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(screen.getByText('Model credentials')).toBeInTheDocument();
    expect(screen.getByText('Jump to Model Settings window')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    await waitFor(() => {
      expect(window.desktop?.settings.openSection).toHaveBeenCalledWith('providers');
    });
  });

  it('shows credential issue count and transitions to the Restored state once resolved', async () => {
    installBridge();
    const onComplete = vi.fn();
    const initial = await snapshotFixture({
      accessibilityTrusted: false,
      screenRecordingTrusted: true,
      connections: [
        connectionFixture({ connectionId: 'conn-1', credentialIssue: 'unreadable' }),
        connectionFixture({
          connectionId: 'conn-2',
          name: 'Anthropic',
          credentialIssue: 'missing',
        }),
      ],
    });

    const { rerenderModal } = renderModal({
      snapshot: initial,
      onDismiss: vi.fn(),
      onComplete,
    });

    expect(
      screen.getByText('2 model connections could not be read; open Model Settings'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();

    const restored = await snapshotFixture({
      accessibilityTrusted: true,
      screenRecordingTrusted: true,
      connections: [
        connectionFixture({ connectionId: 'conn-1' }),
        connectionFixture({ connectionId: 'conn-2', name: 'Anthropic' }),
      ],
    });

    rerenderModal({
      snapshot: restored,
      onDismiss: vi.fn(),
      onComplete,
    });

    expect(screen.getByText('Restored')).toBeInTheDocument();
    expect(screen.getByText('Re-confirmed and saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('offers Open Model Settings primary action when permissions are granted but credentials need attention', async () => {
    installBridge();
    const snapshot = await snapshotFixture({
      accessibilityTrusted: true,
      screenRecordingTrusted: true,
      connections: [connectionFixture({ credentialIssue: 'unreadable' })],
    });

    renderModal({
      snapshot,
      onDismiss: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(
      screen.getByText('1 model connection could not be read; open Model Settings'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Model Settings' }));

    await waitFor(() => {
      expect(window.desktop?.settings.openSection).toHaveBeenCalledWith('providers');
    });
  });

  it('shows the row error alert when opening Model Settings fails', async () => {
    installBridge();
    vi.mocked(window.desktop!.settings.openSection).mockRejectedValueOnce(new Error('ipc failed'));
    const snapshot = await snapshotFixture();

    renderModal({
      snapshot,
      onDismiss: vi.fn(),
      onComplete: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "Couldn't open Model Settings. Please open Settings › Providers manually.",
    );
  });

  it('probes credential statuses when the agent service is connected', async () => {
    installBridge();
    Object.assign(window.desktop!, {
      service: {
        status: vi.fn(async () => ({
          state: 'connected',
          detail: '',
          serviceId: 'svc-1',
          epoch: 1,
          draining: false,
          activeRuns: 0,
          pendingConfirms: 0,
          pendingCapabilities: 0,
          dataDir: null,
          baseUrl: null,
        })),
        onChange: () => () => {},
      } as unknown as ServiceBridge,
    });

    const snapshot = await snapshotFixture();
    renderModal({
      snapshot,
      onDismiss: vi.fn(),
      onComplete: vi.fn(),
    });

    await waitFor(() => {
      expect(window.desktop?.settings.providers.checkStatuses).toHaveBeenCalledTimes(1);
    });
  });
});
