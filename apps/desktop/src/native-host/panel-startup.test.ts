import { AgentHttpClient } from '@atd/agent-client';
import {
  DEFAULT_PANEL_BACKGROUND,
  DEFAULT_SHORTCUTS,
  type InvalidateFrame,
  type SettingsResponse,
} from '@atd/agent-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureCommands } from '../../tests/command-fixtures';
import { DEFAULT_SELECTION_TOOLBAR } from '../client/settings-contract';
import type { NativeBridge } from '../native-bridge/client';
import { publishDragRegions } from './drag-regions';
import { NativeCommands } from './native-commands';
import type { NativeConnection } from './native-connection';
import { nativeSettings } from './native-settings';
import type { WindowMessages } from './window-messages';

const BASE = 'ai-app://renderer';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function settingsResponse(language: 'en' | 'zh-CN' = 'en', revision = 1): SettingsResponse {
  return {
    initialized: true,
    revision,
    settings: {
      language,
      appearance: null,
      glowEffects: true,
      resultMarkdown: true,
      panelBackground: structuredClone(DEFAULT_PANEL_BACKGROUND),
      summaryTitles: true,
      computerVisionModel: null,
      permissionTier: 'manual',
      shellAllowlist: [],
      shortcuts: { ...DEFAULT_SHORTCUTS },
      selectionToolbar: structuredClone(DEFAULT_SELECTION_TOOLBAR),
      screenshotConfirmAction: 'attachAndCopy',
      screenshotConfirmInComposer: false,
      longScreenshotConfirmAction: 'card',
      commandTyping: true,
      commandTypingAnimation: true,
      viewInitiative: 'proactive',
      nextSteps: true,
      nextStepClick: 'fill',
      onboardingCompleted: true,
      onboardingProgress: null,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function connectionStub(initialState: 'connecting' | 'connected' = 'connecting') {
  let state: 'connecting' | 'connected' = initialState;
  const invalidate = new Set<(frame: InvalidateFrame) => void>();
  const connected = new Set<() => void>();
  const http = new AgentHttpClient({ baseUrl: BASE, relay: true });
  const connection = {
    options: () => ({ baseUrl: BASE, relay: true as const }),
    http: () => http,
    status: () => ({ state, message: '' }),
    onInvalidate: (listener: (frame: InvalidateFrame) => void) => {
      invalidate.add(listener);
      return () => invalidate.delete(listener);
    },
    onConnected: (listener: () => void) => {
      connected.add(listener);
      return () => connected.delete(listener);
    },
  } as unknown as NativeConnection;
  return {
    connection,
    setConnected: () => {
      state = 'connected';
      connected.forEach((listener) => listener());
    },
    emitInvalidate: (frame: InvalidateFrame) => invalidate.forEach((listener) => listener(frame)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.windowVisible;
  document.body.innerHTML = '';
});

describe('publishDragRegions', () => {
  it('reports chrome readiness on hidden boot and keeps chrome true under a full-window modal portal', async () => {
    document.documentElement.dataset.windowVisible = 'false';
    const root = document.createElement('div');
    root.id = 'root';
    const header = document.createElement('header');
    header.className = 'panel-header';
    header.getBoundingClientRect = () => new DOMRect(0, 0, 420, 48);
    root.append(header);
    document.body.append(root);

    const raf = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', raf);
    const visibilityListeners = new Set<(state: { visible: boolean }) => void>();
    const post = vi.fn();
    const bridge = {
      post,
      on: (event: string, listener: (state: { visible: boolean }) => void) => {
        if (event === 'window.visibility') visibilityListeners.add(listener);
        return () => visibilityListeners.delete(listener);
      },
    } as unknown as NativeBridge;

    const stop = publishDragRegions(bridge, root);
    expect(raf).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(post).toHaveBeenCalledWith('window.dragRegions', {
      rects: [{ x: 0, y: 0, width: 420, height: 48 }],
      chrome: true,
    });

    // Summon the window and mount a full-viewport modal portal covering the header.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    document.documentElement.dataset.windowVisible = 'true';
    for (const listener of visibilityListeners) listener({ visible: true });

    const portal = document.createElement('div');
    portal.style.pointerEvents = 'auto';
    portal.getBoundingClientRect = () => new DOMRect(0, 0, 420, 640);
    document.body.append(portal);
    await Promise.resolve();
    frames.at(-1)?.(16);

    expect(post).toHaveBeenLastCalledWith('window.dragRegions', {
      rects: [],
      chrome: true,
    });

    stop();
    expect(post).toHaveBeenLastCalledWith('window.dragRegions', {
      rects: [],
      chrome: false,
    });
  });
});

describe('NativeCommands.refreshFromService', () => {
  it('starts a fresh fetch on invalidation instead of dropping it onto a stale in-flight request', async () => {
    const [translate, extract] = fixtureCommands();
    if (!translate || !extract) throw new Error('Expected fixture commands.');
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { connection } = connectionStub('connected');
    const bridge = {
      call: vi.fn(async () => ({ results: [] })),
      post: vi.fn(),
    } as unknown as NativeBridge;
    const commands = new NativeCommands(connection, bridge, () => {});

    const p1 = commands.refreshFromService();
    const p2 = commands.refreshFromService(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Resolve the newer response first, then the stale first response.
    second.resolve(json({ commands: [translate, extract] }));
    await p2;
    expect(commands.list().map((item) => item.id)).toEqual(['translate', 'extract']);

    first.resolve(json({ commands: [translate] }));
    await p1;
    expect(commands.list().map((item) => item.id)).toEqual(['translate', 'extract']);
  });
});

describe('nativeSettings prime & onConnected', () => {
  it('retries settings reload cleanly without firing onLoadError when a pre-stream prime fails', async () => {
    const primeAttempt = deferred<Response>();
    const urlOf = (input: RequestInfo | URL) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let settingsCalls = 0;
    const fetchMock = vi.fn<typeof fetch>((url) => {
      const target = urlOf(url);
      if (target.endsWith('/v1/settings')) {
        settingsCalls += 1;
        if (settingsCalls === 1) return primeAttempt.promise;
        return Promise.resolve(json(settingsResponse('zh-CN', 2)));
      }
      if (target.endsWith('/v1/providers')) {
        return Promise.resolve(
          json({ connections: [], defaultConnectionId: null, aliases: [], defaultAliasId: null }),
        );
      }
      throw new Error(`Unexpected URL: ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { connection, setConnected } = connectionStub('connecting');
    const native = {
      call: vi.fn(async () => ({
        pinned: false,
        showInDock: false,
        openAtLogin: null,
        widgetsAvailable: true,
        panelPlacement: 'bottomRight' as const,
      })),
    } as unknown as NativeBridge;
    const messages = { post: vi.fn(), listen: () => () => {} } as unknown as WindowMessages;

    const settings = nativeSettings(connection, messages, native, 'panel');
    const onLoadError = vi.fn();
    settings.onLoadError(onLoadError);

    const primed = settings.prime();
    // Stream connects while `prime()` is still in flight, then the pre-stream prime fails.
    setConnected();
    primeAttempt.reject(new Error('Service socket was not ready yet'));
    await primed;
    await vi.waitFor(() => {
      expect(settings.loaded()).toBe(true);
    });
    expect(onLoadError).not.toHaveBeenCalled();
    await expect(settings.bridge.get()).resolves.toMatchObject({ language: 'zh-CN' });
  });
});
