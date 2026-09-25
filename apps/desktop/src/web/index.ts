import { AgentRequests } from '../../electron/agent/agent-requests';
import {
  createAgentBridge,
  type AgentChannel,
  type AgentChannelValues,
} from '../../electron/agent/bridge-client';
import type { DesktopBridge } from '../../electron/contract';
import { createServiceBridge } from '../../electron/service/bridge-client';
import { handleExtensionRequest } from '../../electron/service/extension-requests';
import type { ServiceEvent } from '../../electron/service/ipc';
import { establishSession, type SessionResult } from './host-session';
import { WebCommands } from './web-commands';
import { WebConnection } from './web-connection';
import { webEvents } from './web-events';
import { webPlatform } from './web-platform';
import { webSettings } from './web-settings';

export type WebHostState = { kind: 'ready' } | Exclude<SessionResult, { kind: 'ready' }>;

/** The OS as a Node platform name, for shortcut semantics (⌘ on macOS, Ctrl elsewhere). */
function detectPlatform(): string {
  const name = navigator.platform || navigator.userAgent;
  if (/mac/i.test(name)) return 'darwin';
  if (/win/i.test(name)) return 'win32';
  return 'linux';
}

const openExternal = async (url: string) => void window.open(url, '_blank', 'noopener,noreferrer');

/**
 * Installs `window.desktop` for the browser client served by the agent service. It runs the same
 * request handling, task cache and provider client as the desktop main process, against the
 * service directly with this browser's session; only host abilities (file chooser, clipboard,
 * links, settings tab) differ. Resolves `ready`, or why the page cannot sign in yet.
 */
export async function installWebHost(): Promise<WebHostState> {
  const session = await establishSession();
  if (session.kind !== 'ready') return session;
  const platform = detectPlatform();
  const connection = new WebConnection(session.options, session.serviceId);
  const events = webEvents();
  const channels: { [C in AgentChannel]: Set<(value: AgentChannelValues[C]) => void> } = {
    changed: new Set(),
    launch: new Set(),
    session: new Set(),
    extensionSession: new Set(),
  };
  const emit = <C extends AgentChannel>(channel: C, value: AgentChannelValues[C]) => {
    for (const listener of channels[channel]) listener(value);
  };
  const listen = <C extends AgentChannel>(
    channel: C,
    listener: (value: AgentChannelValues[C]) => void,
  ) => {
    channels[channel].add(listener);
    return () => {
      channels[channel].delete(listener);
    };
  };

  const settings = webSettings(connection, events, platform);
  const commands = new WebCommands(connection, platform, () => requests.broadcast());
  const requests = new AgentRequests<'page'>(
    connection,
    commands,
    webPlatform((prepared, autoRun) => emit('launch', { prepared, autoRun })),
    {
      emit: (event) => emit('changed', event),
      defaultConnectionId: () => settings.providers.overlay()?.defaultConnectionId ?? null,
      defaultModel: () => {
        const live = settings.providers.overlay();
        const id = live?.defaultConnectionId;
        const model = live?.connections.find((item) => item.connectionId === id)?.defaultModel;
        return id && model ? { connectionId: id, modelId: model } : undefined;
      },
    },
    (_page, event) => emit('changed', event),
  );
  connection.onInvalidate((frame) => void requests.onInvalidate(frame));
  connection.onConnected(() => void commands.refreshFromService().catch(() => undefined));
  events.listen((message) => {
    if (message.type === 'commandSession') {
      const name = commands.list().find((item) => item.id === message.commandId)?.name ?? '';
      emit('session', { commandId: message.commandId, name });
      window.focus();
    } else if (message.type === 'extensionSession') {
      emit('extensionSession', { kind: message.kind });
      window.focus();
    }
  });

  const serviceListeners = new Set<(event: ServiceEvent) => void>();
  const serviceEmit = (event: ServiceEvent) => {
    for (const listener of serviceListeners) listener(event);
  };
  connection.onStatus((status) => serviceEmit({ type: 'status', status }));
  connection.onInvalidate((frame) => {
    if (frame.scope === 'extensions') serviceEmit({ type: 'extensions' });
  });

  connection.connect();
  await Promise.all([commands.refreshFromService().catch(() => undefined), settings.ready]);

  const bridge: DesktopBridge = {
    runtime: 'web',
    platform,
    settings: settings.bridge,
    agent: createAgentBridge((request) => requests.handle(request, 'page'), listen),
    service: createServiceBridge(
      async (request) => {
        switch (request.action) {
          case 'status':
            return connection.status();
          case 'connect':
          case 'disconnect':
          case 'startLocal':
          case 'openInBrowser':
            throw new Error('Manage the service connection from the desktop app.');
          default:
            return handleExtensionRequest(connection.options(), request, openExternal);
        }
      },
      (listener) => {
        serviceListeners.add(listener);
        return () => serviceListeners.delete(listener);
      },
    ),
    show: async () => window.focus(),
    hide: async () => undefined,
    getState: async () => ({ pinned: false, shortcut: '', shortcutAvailable: false }),
    setPinned: async () => {
      throw new Error('Keeping the panel on top needs the desktop app.');
    },
    chooseFiles: async () => [],
  };
  window.desktop = bridge;
  return { kind: 'ready' };
}
