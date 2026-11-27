import type { StreamTransportEvents, StreamTransportFactory } from '@atd/agent-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import { bridgeKeys } from '../../lib/bridge-cache';
import { queryClient } from '../../lib/query-client';
import type { ServiceBridge } from '../../client/service/ipc';
import { NativeBridge } from '../../native-bridge/client';
import { publishDragRegions } from '../../native-host/drag-regions';
import { NativeConnection } from '../../native-host/native-connection';
import { ServiceBanner } from '../service/service-banner';
import { diagnosticsBreadcrumbs } from './breadcrumbs';
import { DiagnosticsErrorBoundary } from './error-boundary';

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('Synthetic render crash');
  return <div>Recovered view</div>;
}

describe('DiagnosticsErrorBoundary and service failure propagation', () => {
  afterEach(() => {
    diagnosticsBreadcrumbs.clear();
    vi.restoreAllMocks();
  });

  it('renders draggable .diagnostics-error-header, resets on hashchange/retry, and exports bundle', async () => {
    const { exportBundle } = (() => {
      installBridge();
      const exportBundle = vi.fn(async () => ({
        outcome: 'saved' as const,
        fileName: 'atd-diagnostics.zip',
        archiveBytes: 2048,
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
          previewBundle: vi.fn(),
          exportBundle,
          restartService: vi.fn(),
        },
      };
      return { exportBundle };
    })();

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { aiNative: { postMessage } } };
    const native = NativeBridge.connect()!;
    const stopDrag = publishDragRegions(native, document.body);

    // Mock non-zero bounding rect for .diagnostics-error-header so drag-regions posts chrome: true.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList?.contains('diagnostics-error-header')) {
          return new DOMRect(0, 0, 400, 52);
        }
        return new DOMRect(0, 0, 0, 0);
      });

    let shouldExplode = true;
    const { rerender } = render(
      <DiagnosticsErrorBoundary
        onReset={() => {
          shouldExplode = false;
        }}
      >
        <Boom explode={shouldExplode} />
      </DiagnosticsErrorBoundary>,
    );

    expect(document.querySelector('.diagnostics-error-header')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic render crash');
    expect(
      diagnosticsBreadcrumbs.snapshot().entries.some((e) => e.category === 'error_boundary'),
    ).toBe(true);

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'post',
          method: 'window.dragRegions',
          params: expect.objectContaining({
            chrome: true,
            rects: [expect.objectContaining({ width: 400, height: 52 })],
          }),
        }),
      );
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Export diagnostics…' }));
    expect(exportBundle).toHaveBeenCalledWith(false);
    expect(await screen.findByText(/atd-diagnostics\.zip/)).toBeVisible();

    // Verify hashchange resets boundary.
    shouldExplode = false;
    rerender(
      <DiagnosticsErrorBoundary>
        <Boom explode={false} />
      </DiagnosticsErrorBoundary>,
    );
    act(() => {
      fireEvent(window, new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByText('Recovered view')).toBeVisible();

    stopDrag();
    rectSpy.mockRestore();
    spy.mockRestore();
  });

  it('parses WS close failureCode + detail and offers Diagnose / Restart service in ServiceBanner', async () => {
    const sockets: StreamTransportEvents[] = [];
    const transport: StreamTransportFactory = {
      open(_url, events) {
        sockets.push(events);
        return { send: () => undefined, close: () => undefined };
      },
    };
    const connection = new NativeConnection({
      baseUrl: 'ai-app://renderer',
      relay: true,
      transport,
    });
    connection.connect();
    sockets[0]!.onClose(1011, 'service_start_failed: SyntaxError in entrypoint');

    expect(connection.status().failureCode).toBe('service_start_failed');
    expect(connection.status().detail).toBe('SyntaxError in entrypoint');
    expect(
      diagnosticsBreadcrumbs.snapshot().entries.some((e) => e.category === 'stream_state'),
    ).toBe(true);

    installBridge();
    const restartService = vi.fn(async () => ({ ok: true as const }));
    const openSection = vi.fn(async () => {});
    window.desktop = {
      ...window.desktop!,
      settings: { ...window.desktop!.settings, openSection },
      service: {
        status: async () => connection.status(),
      } as unknown as ServiceBridge,
      diagnostics: {
        runDoctor: vi.fn(),
        shellReport: vi.fn(),
        startLiveProbe: vi.fn(),
        stopLiveProbe: vi.fn(),
        onLiveProbeEvent: () => () => {},
        previewBundle: vi.fn(),
        exportBundle: vi.fn(),
        restartService,
      },
    };
    queryClient.setQueryData(bridgeKeys.serviceStatus, connection.status());

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ServiceBanner onOpenSettings={vi.fn()} />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/SyntaxError in entrypoint/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open Service settings' })).toBeVisible();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Diagnose' }));
    expect(openSection).toHaveBeenCalledWith('diagnostics');

    await user.click(screen.getByRole('button', { name: 'Restart service' }));
    expect(restartService).toHaveBeenCalledOnce();
  });
});
