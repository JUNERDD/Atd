import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DoctorRunResponse } from '@atd/agent-contracts';
import { installBridge } from '../../../tests/app-test-bridge';
import type {
  BundlePreviewResult,
  LiveProbeEvent,
  ShellDoctorCheck,
  ShellDoctorReport,
} from '../../client/diagnostics-contract';
import { SettingsSectionActiveContext } from '../settings/settings-navigation';
import { DiagnosticsSettings } from './diagnostics-settings';
import { LiveProbePanel } from './live-probe-panel';
import { PrivacyPreviewDialog } from './privacy-preview-dialog';

function makeShellReport(checks: ShellDoctorCheck[] = []): ShellDoctorReport {
  return {
    capturedAt: '2026-11-18T10:00:00.000Z',
    appVersion: '0.12.0',
    buildNumber: '120',
    isDevelopment: false,
    serviceState: 'running',
    serviceFailureCode: null,
    serviceFailureSummary: null,
    checks,
    rings: [
      {
        ringId: 'selection',
        capacity: 64,
        entryCount: 3,
        droppedCount: 0,
        lastEventAt: null,
        recentAnomalyCount: 0,
        heldResources: [],
      },
    ],
  };
}

function makeDoctorResponse(includeConnectivity: boolean): DoctorRunResponse {
  return {
    ranAt: '2026-11-18T10:00:01.000Z',
    serviceEpoch: 1,
    durationMs: 25,
    includeConnectivity,
    checks: [
      {
        id: 'conn.provider_endpoints',
        layer: 'on_demand_connectivity',
        status: includeConnectivity ? 'pass' : 'skipped',
        reasonCode: includeConnectivity ? 'ok' : 'not_requested',
        durationMs: 12,
        metrics: {},
      },
    ],
  };
}

function makePreview(includeCrashes: boolean, excerpt = '{"ok":true}'): BundlePreviewResult {
  return {
    generatedAt: '2026-11-18T10:00:00.000Z',
    suggestedFileName: 'atd-diagnostics.zip',
    totalUncompressedBytes: 2048,
    totalRedactionHits: 1,
    omittedFileCount: includeCrashes ? 0 : 1,
    files: [
      {
        path: 'environment.json',
        status: 'included',
        byteSize: 1024,
        redactionHits: 1,
        previewExcerpt: excerpt,
        excerptTruncated: false,
      },
    ],
  };
}

function installDiagnosticsBridge(
  overrides: Partial<NonNullable<NonNullable<typeof window.desktop>['diagnostics']>> = {},
) {
  installBridge();
  window.desktop = {
    ...window.desktop!,
    diagnostics: {
      runDoctor: vi.fn(),
      shellReport: vi.fn(),
      startLiveProbe: vi.fn(),
      stopLiveProbe: vi.fn(),
      onLiveProbeEvent: () => () => {},
      previewBundle: vi.fn(),
      exportBundle: vi.fn(),
      restartService: vi.fn(),
      ...overrides,
    },
  };
}

describe('Desktop diagnostics UI Bugbot fixes (B22, B23, B24)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('B23: re-runs Doctor on connectivity toggle, ignores Activity hide/show, and clears stale shellReport on error', async () => {
    const runDoctor = vi.fn(async (withConnectivity = false) =>
      makeDoctorResponse(withConnectivity),
    );
    const shellReport = vi
      .fn<() => Promise<ShellDoctorReport>>()
      .mockResolvedValueOnce(
        makeShellReport([
          {
            id: 'perm.accessibility',
            layer: 'permissions_and_keychain',
            status: 'pass',
            reasonCode: 'ok',
            durationMs: 5,
            metrics: [],
          },
        ]),
      )
      .mockRejectedValueOnce(new Error('shell_report_failed'));

    installDiagnosticsBridge({ runDoctor, shellReport });
    const { rerender } = render(
      <TooltipProvider>
        <SettingsSectionActiveContext value={true}>
          <DiagnosticsSettings />
        </SettingsSectionActiveContext>
      </TooltipProvider>,
    );

    expect(await screen.findByText('Accessibility permission')).toBeVisible();
    expect(screen.getByText('Skipped unless network & clock check is enabled.')).toBeVisible();
    expect(runDoctor).toHaveBeenCalledTimes(1);

    rerender(
      <TooltipProvider>
        <SettingsSectionActiveContext value={false}>
          <DiagnosticsSettings />
        </SettingsSectionActiveContext>
      </TooltipProvider>,
    );
    rerender(
      <TooltipProvider>
        <SettingsSectionActiveContext value={true}>
          <DiagnosticsSettings />
        </SettingsSectionActiveContext>
      </TooltipProvider>,
    );
    expect(runDoctor).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: 'Include network & clock check' }));
    await waitFor(() => expect(runDoctor).toHaveBeenLastCalledWith(true));
    expect(await screen.findByText('shell_report_failed')).toBeVisible();
    expect(screen.queryByText('Accessibility permission')).not.toBeInTheDocument();
    expect(screen.queryByText('Native decision rings')).not.toBeInTheDocument();
  });

  it('B22: disarms in-flight LiveProbe across section deactivation, clears requestedProbe, and filters stale probeId events', async () => {
    let resolveStart:
      | ((value: { probeId: string; kind: 'selection'; durationMs: number }) => void)
      | null = null;
    let emitEvent: ((event: LiveProbeEvent) => void) | null = null;
    const startLiveProbe = vi.fn(
      () =>
        new Promise<{ probeId: string; kind: 'selection'; durationMs: number }>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const stopLiveProbe = vi.fn(async () => {});
    const onHandled = vi.fn();

    installDiagnosticsBridge({
      startLiveProbe,
      stopLiveProbe,
      onLiveProbeEvent: (listener) => {
        emitEvent = listener;
        return () => {
          emitEvent = null;
        };
      },
    });

    const { rerender } = render(
      <SettingsSectionActiveContext value={true}>
        <LiveProbePanel requestedProbe="selection" onRequestedProbeHandled={onHandled} />
      </SettingsSectionActiveContext>,
    );
    expect(startLiveProbe).toHaveBeenCalledWith('selection');

    rerender(
      <SettingsSectionActiveContext value={false}>
        <LiveProbePanel requestedProbe="selection" onRequestedProbeHandled={onHandled} />
      </SettingsSectionActiveContext>,
    );
    await waitFor(() => expect(stopLiveProbe).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveStart?.({ probeId: 'probe-stale', kind: 'selection', durationMs: 10_000 });
    });
    expect(stopLiveProbe).toHaveBeenCalledTimes(2);
    expect(onHandled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Stop/ })).not.toBeInTheDocument();

    startLiveProbe.mockResolvedValueOnce({
      probeId: 'probe-live',
      kind: 'selection',
      durationMs: 10_000,
    });
    rerender(
      <SettingsSectionActiveContext value={true}>
        <LiveProbePanel requestedProbe={null} onRequestedProbeHandled={onHandled} />
      </SettingsSectionActiveContext>,
    );
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Start 10s probe' })[0]!);
    expect(await screen.findByRole('button', { name: 'Stop (10s)' })).toBeVisible();

    act(() => {
      emitEvent?.({
        kind: 'selection',
        probeId: 'probe-stale',
        ts: '2026-11-18T10:00:01.000Z',
        remainingMs: 5000,
        endedReason: 'timeout',
        axTrusted: false,
        frontmostBundleId: null,
        excludedByAppRule: false,
        axRole: null,
        selectedLength: 0,
        gateOutcome: 'stale_ignored',
      });
    });
    expect(screen.queryByText(/stale_ignored/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop (10s)' })).toBeVisible();
  });

  it('B24: resets PrivacyPreviewDialog state on close, ignores stale resolves, and disables Save on preview error', async () => {
    let resolveSecond: ((value: BundlePreviewResult) => void) | null = null;
    const previewBundle = vi
      .fn<(include: boolean) => Promise<BundlePreviewResult>>()
      .mockResolvedValueOnce(makePreview(false, '{"first":true}'))
      .mockResolvedValueOnce(makePreview(true, '{"crashes":true}'))
      .mockImplementationOnce(
        () =>
          new Promise<BundlePreviewResult>((resolve) => {
            resolveSecond = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('preview_failed'));

    installDiagnosticsBridge({ previewBundle });
    const { rerender } = render(<PrivacyPreviewDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('{"first":true}')).toBeVisible();

    const user = userEvent.setup();
    const crashSwitch = screen.getByRole('switch');
    await user.click(crashSwitch);
    expect(await screen.findByText('{"crashes":true}')).toBeVisible();
    expect(crashSwitch).toBeChecked();

    rerender(<PrivacyPreviewDialog open={false} onOpenChange={vi.fn()} />);
    rerender(<PrivacyPreviewDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText('Preparing redacted preview…')).toBeVisible();
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save archive…' })).toBeDisabled();

    rerender(<PrivacyPreviewDialog open={false} onOpenChange={vi.fn()} />);
    await act(async () => {
      resolveSecond?.(makePreview(false, '{"late":true}'));
    });

    rerender(<PrivacyPreviewDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(previewBundle).toHaveBeenCalledTimes(4));
    expect(screen.getByRole('button', { name: 'Save archive…' })).toBeDisabled();
  });
});
