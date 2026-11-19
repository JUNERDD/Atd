import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import type {
  BundlePreviewResult,
  LiveProbeEvent,
  ShellDoctorReport,
} from '../../client/diagnostics-contract';
import enCommon from '../../i18n/locales/en/common.json';
import enDiagnostics from '../../i18n/locales/en/diagnostics.json';
import enPanel from '../../i18n/locales/en/panel.json';
import enSettings from '../../i18n/locales/en/settings.json';
import zhCommon from '../../i18n/locales/zh-CN/common.json';
import zhDiagnostics from '../../i18n/locales/zh-CN/diagnostics.json';
import zhPanel from '../../i18n/locales/zh-CN/panel.json';
import zhSettings from '../../i18n/locales/zh-CN/settings.json';
import { SettingsSectionActiveContext } from '../settings/settings-navigation';
import { loadSettingsSection } from '../settings/settings-section-loaders';
import { SettingsWindow } from '../settings/settings-window';
import { DiagnosticsSettings } from './diagnostics-settings';
import { LiveProbePanel } from './live-probe-panel';
import { PrivacyPreviewDialog } from './privacy-preview-dialog';

function collectKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>)
    .flatMap(([key, value]) => collectKeys(value, prefix ? `${prefix}.${key}` : key))
    .sort();
}

function collectPluralNormalizedKeys(obj: unknown): string[] {
  return [
    ...new Set(collectKeys(obj).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, ''))),
  ].sort();
}

function makeShellReport(): ShellDoctorReport {
  return {
    capturedAt: '2026-11-18T10:00:00.000Z',
    appVersion: '0.12.0',
    buildNumber: '120',
    isDevelopment: false,
    serviceState: 'unavailable',
    serviceFailureCode: 'service_start_failed',
    serviceFailureSummary: 'Port 4321 already bound',
    checks: [
      {
        id: 'perm.accessibility',
        layer: 'permissions_and_keychain',
        status: 'fail',
        reasonCode: 'stale_or_duplicate_app_grant',
        durationMs: 12,
        metrics: [{ key: 'duplicateBundles', value: '2' }],
        remediation: {
          remediationCode: 'grant_or_reset_accessibility',
          action: 'open_system_settings_accessibility',
        },
      },
    ],
    rings: [
      {
        ringId: 'selection',
        capacity: 64,
        entryCount: 3,
        droppedCount: 0,
        lastEventAt: null,
        recentAnomalyCount: 1,
        heldResources: [],
      },
    ],
  };
}

describe('DiagnosticsSettings, PrivacyPreviewDialog, LiveProbePanel, and i18n parity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps identical en and zh-CN key sets across all modified i18n namespaces', () => {
    expect(collectKeys(enDiagnostics)).toEqual(collectKeys(zhDiagnostics));
    expect(collectPluralNormalizedKeys(enSettings)).toEqual(
      collectPluralNormalizedKeys(zhSettings),
    );
    expect(collectPluralNormalizedKeys(enPanel)).toEqual(collectPluralNormalizedKeys(zhPanel));
    expect(collectPluralNormalizedKeys(enCommon)).toEqual(collectPluralNormalizedKeys(zhCommon));
  });

  it('renders Diagnostics inside SettingsWindow when service is offline, keeps valid ul > li DOM, and runs remediations', async () => {
    await loadSettingsSection('diagnostics');
    installBridge();
    vi.mocked(window.desktop!.settings.get).mockRejectedValue(new Error('503 service offline'));
    const requestAccessibility = vi.mocked(window.desktop!.settings.requestAccessibility);
    const restartService = vi.fn(async () => ({ ok: true as const }));
    const runDoctor = vi.fn(async () => {
      throw new Error('503 service_start_failed');
    });

    window.desktop = {
      ...window.desktop!,
      diagnostics: {
        runDoctor,
        shellReport: vi.fn(async () => makeShellReport()),
        startLiveProbe: vi.fn(),
        stopLiveProbe: vi.fn(),
        onLiveProbeEvent: () => () => {},
        previewBundle: vi.fn(),
        exportBundle: vi.fn(),
        restartService,
      },
    };
    window.location.hash = '#settings?section=diagnostics';

    render(<SettingsWindow />);

    expect(await screen.findByText('Accessibility permission')).toBeVisible();
    expect(screen.getByText('Port 4321 already bound')).toBeVisible();

    // Every ItemGroup <ul> must contain direct <li> children only (no <ul> > <div> > <li>).
    const lists = document.querySelectorAll('ul[data-slot="item-group"]');
    expect(lists.length).toBeGreaterThanOrEqual(2);
    for (const ul of lists) {
      expect(ul.querySelectorAll(':scope > div').length).toBe(0);
      expect(ul.querySelectorAll(':scope > li').length).toBeGreaterThan(0);
    }

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Show check details' }));
    const pre = document.querySelector('pre');
    expect(pre).toBeInTheDocument();
    expect(pre?.className).not.toMatch(/overflow-auto|overflow-x-auto/);

    await user.click(screen.getByRole('button', { name: 'Open Accessibility…' }));
    expect(requestAccessibility).toHaveBeenCalledOnce();
  });

  it('uses translucent glass-safe items in PrivacyPreviewDialog and refreshes on .ips toggle', async () => {
    installBridge();
    const previewBundle = vi.fn(
      async (includeCrashSummaries: boolean): Promise<BundlePreviewResult> => ({
        generatedAt: '2026-11-18T10:00:00.000Z',
        suggestedFileName: 'atd-diagnostics.zip',
        totalUncompressedBytes: 2048,
        totalRedactionHits: 4,
        omittedFileCount: includeCrashSummaries ? 0 : 1,
        files: [
          {
            path: 'environment.json',
            status: 'included',
            byteSize: 1024,
            redactionHits: 2,
            previewExcerpt: '{"ok":true}',
            excerptTruncated: false,
          },
          {
            path: 'crashes/summary.json',
            status: includeCrashSummaries ? 'included' : 'omitted_not_opted_in',
            byteSize: includeCrashSummaries ? 512 : 0,
            redactionHits: 0,
            previewExcerpt: includeCrashSummaries ? 'Atd+0x123' : null,
            excerptTruncated: false,
          },
        ],
      }),
    );
    const exportBundle = vi.fn(async () => ({
      outcome: 'saved' as const,
      fileName: 'atd-diagnostics.zip',
      archiveBytes: 1024,
      omittedFileCount: 0,
    }));

    window.desktop = {
      ...window.desktop!,
      diagnostics: {
        runDoctor: vi.fn(),
        shellReport: vi.fn(),
        startLiveProbe: vi.fn(),
        stopLiveProbe: vi.fn(),
        onLiveProbeEvent: () => () => {},
        previewBundle,
        exportBundle,
        restartService: vi.fn(),
      },
    };

    render(<PrivacyPreviewDialog open onOpenChange={vi.fn()} />);

    await waitFor(() => expect(previewBundle).toHaveBeenCalledWith(false));
    expect(await screen.findByText('environment.json')).toBeVisible();

    // Dialog file items must never use opaque variant="outline" inside glass-host dialog.
    const dialog = screen.getByRole('dialog');
    const items = dialog.querySelectorAll('[data-slot="item"]');
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.getAttribute('data-variant')).not.toBe('outline');
    }

    const user = userEvent.setup();
    await user.click(screen.getByRole('switch'));
    await waitFor(() => expect(previewBundle).toHaveBeenCalledWith(true));

    await user.click(screen.getByRole('button', { name: 'Save archive…' }));
    expect(exportBundle).toHaveBeenCalledWith(true);
  });

  it('stops active 10s LiveProbe when SettingsSectionActiveContext becomes hidden or on unmount', async () => {
    installBridge();
    let emitEvent: ((event: LiveProbeEvent) => void) | null = null;
    const startLiveProbe = vi.fn(async () => ({
      probeId: 'probe-1',
      kind: 'selection' as const,
      durationMs: 10_000,
    }));
    const stopLiveProbe = vi.fn(async () => {});

    window.desktop = {
      ...window.desktop!,
      diagnostics: {
        runDoctor: vi.fn(),
        shellReport: vi.fn(),
        startLiveProbe,
        stopLiveProbe,
        onLiveProbeEvent: (listener) => {
          emitEvent = listener;
          return () => {
            emitEvent = null;
          };
        },
        previewBundle: vi.fn(),
        exportBundle: vi.fn(),
        restartService: vi.fn(),
      },
    };

    const { rerender, unmount } = render(
      <SettingsSectionActiveContext value={true}>
        <LiveProbePanel />
      </SettingsSectionActiveContext>,
    );

    const user = userEvent.setup();
    const startButtons = screen.getAllByRole('button', { name: 'Start 10s probe' });
    await user.click(startButtons[0]!);
    expect(startLiveProbe).toHaveBeenCalledWith('selection');
    expect(await screen.findByRole('button', { name: 'Stop (10s)' })).toBeVisible();

    act(() => {
      emitEvent?.({
        kind: 'selection',
        probeId: 'probe-1',
        ts: '2026-11-18T10:00:02.000Z',
        remainingMs: 8000,
        endedReason: 'running',
        axTrusted: true,
        frontmostBundleId: 'com.google.Chrome',
        excludedByAppRule: false,
        axRole: 'AXTextArea',
        selectedLength: 14,
        gateOutcome: 'panel_shown',
      });
    });
    expect(within(document.body).getByText(/gate=panel_shown/)).toBeVisible();

    rerender(
      <SettingsSectionActiveContext value={false}>
        <LiveProbePanel />
      </SettingsSectionActiveContext>,
    );
    await waitFor(() => expect(stopLiveProbe).toHaveBeenCalledTimes(1));

    // Start again and verify unmount also calls stopLiveProbe.
    rerender(
      <SettingsSectionActiveContext value={true}>
        <LiveProbePanel />
      </SettingsSectionActiveContext>,
    );
    await user.click(screen.getAllByRole('button', { name: 'Start 10s probe' })[0]!);
    unmount();
    await waitFor(() => expect(stopLiveProbe).toHaveBeenCalledTimes(2));
  });

  it('passes DiagnosticsSettings standalone render smoke check with offline shell fallback', async () => {
    installBridge();
    window.desktop = {
      ...window.desktop!,
      diagnostics: {
        runDoctor: vi.fn(async () => {
          throw new Error('503');
        }),
        shellReport: vi.fn(async () => makeShellReport()),
        startLiveProbe: vi.fn(),
        stopLiveProbe: vi.fn(),
        onLiveProbeEvent: () => () => {},
        previewBundle: vi.fn(),
        exportBundle: vi.fn(),
        restartService: vi.fn(),
      },
    };
    render(
      <TooltipProvider>
        <DiagnosticsSettings />
      </TooltipProvider>,
    );
    expect(await screen.findByText('Accessibility permission')).toBeVisible();
  });
});
