import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import type {
  ComputerBridge,
  ComputerChromeState,
  ComputerShellState,
} from '../../client/computer-contract';
import * as toastStore from '../../components/toast-store';
import { ComputerChromeCard } from './computer-chrome-card';

const EXTENSION_ID = 'eolengaocpdgjapbjdfpfcokjpgjaedi';

function makeShell(chrome: Partial<ComputerChromeState> = {}): ComputerShellState {
  return {
    host: 'ready',
    pointerVisible: false,
    typing: true,
    typingAnimation: true,
    engines: [],
    unsettled: { count: 0, actionIds: [] },
    previews: [],
    captureConsent: null,
    postEventAccess: true,
    chrome: {
      hostManifest: 'installed',
      browsers: [],
      extensionIds: { expected: EXTENSION_ID },
      connections: [],
      ...chrome,
    },
  };
}

function installComputerBridge(overrides: Partial<ComputerBridge> = {}) {
  installBridge();
  const refreshChrome = vi.fn(async () => {});
  const disconnectChrome = vi.fn(async () => {});
  const computer: ComputerBridge = {
    applicationIcon: vi.fn(async () => null),
    listApplications: vi.fn(async () => []),
    status: vi.fn(async () => ({
      host: { state: 'ready' as const, profiles: [] },
      bindings: [],
      busy: [],
    })),
    removeBinding: vi.fn(async () => ({ invalidatedAutomationIds: [] })),
    stopAll: vi.fn(async () => ({ stoppedRunIds: [] })),
    progress: vi.fn(async () => []),
    onProgress: () => () => {},
    onState: () => () => {},
    showPreview: vi.fn(async () => ({ shown: true })),
    onChange: () => () => {},
    prepareBrowser: vi.fn(),
    prepareApplication: vi.fn(),
    unresolvedFacts: vi.fn(async () => []),
    resolveFacts: vi.fn(),
    primeCaptureConsent: vi.fn(),
    acknowledgeUnsettled: vi.fn(async () => {}),
    openProfile: vi.fn(async () => {}),
    setPointerVisible: vi.fn(async () => {}),
    setTyping: vi.fn(async () => {}),
    disconnectChrome,
    refreshChrome,
    pickApp: vi.fn(async () => null),
    ...overrides,
  };
  window.desktop = { ...window.desktop!, computer };
  return { computer, refreshChrome, disconnectChrome };
}

describe('ComputerChromeCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      hostManifest: 'installed' as const,
      title: 'Ready to connect',
      description: /Your browser can reach Atd\./,
    },
    {
      hostManifest: 'chromeMissing' as const,
      title: 'No compatible browser found',
      description: /Open a Chromium browser .* then click Refresh\./,
    },
    {
      hostManifest: 'blockedLocation' as const,
      title: 'Move Atd to Applications',
      description: /Browsers can’t start Atd from where it is now/,
    },
    {
      hostManifest: 'failed' as const,
      title: 'Couldn’t set up the browser connection',
      description: /Atd couldn’t register itself with your browsers\./,
    },
  ])(
    'renders the $hostManifest host manifest state with extension metadata',
    ({ hostManifest, title, description }) => {
      render(<ComputerChromeCard shell={makeShell({ hostManifest })} offline={false} />);

      expect(screen.getByText(title)).toBeVisible();
      expect(screen.getByText(description)).toBeVisible();
      expect(screen.getByText(new RegExp(`ID ${EXTENSION_ID}`))).toBeVisible();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeVisible();
    },
  );

  it('omits the browsers line when empty and renders the comma-joined list with hover title when populated', () => {
    const { rerender } = render(
      <ComputerChromeCard shell={makeShell({ browsers: [] })} offline={false} />,
    );
    expect(screen.queryByText(/^Browsers:/)).not.toBeInTheDocument();

    rerender(
      <ComputerChromeCard
        shell={makeShell({ browsers: ['Arc', 'Aside', 'Google Chrome'] })}
        offline={false}
      />,
    );
    const detail = screen.getByText('Browsers: Arc, Aside, Google Chrome');
    expect(detail).toBeVisible();
    expect(detail).toHaveAttribute('title', 'Browsers: Arc, Aside, Google Chrome');
  });

  it('calls refreshChrome with loading state while pending and recovers when resolved', async () => {
    let finishRefresh!: () => void;
    const refreshChrome = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    installComputerBridge({ refreshChrome });

    render(
      <ComputerChromeCard
        shell={makeShell({ hostManifest: 'installed', browsers: ['Aside'] })}
        offline={false}
      />,
    );

    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');

    await user.click(button);

    expect(refreshChrome).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();

    // Clicking again while disabled / in flight must not trigger another refresh.
    await user.click(button);
    expect(refreshChrome).toHaveBeenCalledTimes(1);

    finishRefresh();

    await waitFor(() => {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-busy');
      expect(button.querySelector('[data-slot="spinner"]')).toBeNull();
    });
  });

  it('shows an error toast and clears loading state when refreshChrome rejects', async () => {
    const failure = new Error('Native messaging manifest write failed');
    const refreshChrome = vi.fn(async () => {
      throw failure;
    });
    installComputerBridge({ refreshChrome });
    const toastSpy = vi.spyOn(toastStore, 'showErrorToast').mockImplementation(() => {});

    render(<ComputerChromeCard shell={makeShell({ hostManifest: 'failed' })} offline={false} />);

    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Refresh' });
    await user.click(button);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(failure);
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-busy');
    });
  });

  it('shows browser-agnostic install steps before any profile connects and hides status when shell is null', () => {
    render(<ComputerChromeCard shell={null} offline={false} />);

    expect(screen.getByText('No browser profile connected')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });
});
