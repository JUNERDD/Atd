import { AgentRequests } from '../../electron/agent/agent-requests';
import { parseExtensionSession, type ExtensionSession } from '../../electron/agent/bridge';
import {
  createAgentBridge,
  type AgentChannel,
  type AgentChannelValues,
} from '../../electron/agent/bridge-client';
import type { DesktopBridge } from '../../electron/contract';
import { createServiceBridge } from '../../electron/service/bridge-client';
import { handleExtensionRequest } from '../../electron/service/extension-requests';
import type { ServiceEvent } from '../../electron/service/ipc';
import type { NativeBridge } from '../native-bridge/client';
import { setWindowActive, setWindowVisible } from '../window-state';
import { publishDragRegions } from './drag-regions';
import { NativeCommands } from './native-commands';
import { NativeConnection } from './native-connection';
import { nativePlatform } from './native-platform';
import { nativeSettings } from './native-settings';
import { nativeShortcuts } from './native-shortcuts';
import { nativeSocketTransport } from './socket-transport';
import { windowMessages } from './window-messages';

/**
 * The page's origin, the base of every relayed request: `ai-app://renderer`. WebKit may report a
 * custom scheme's origin as opaque (`"null"`), so it is rebuilt from the scheme and host then.
 */
function pageOrigin(): string {
  const { origin, protocol, host } = window.location;
  return origin === 'null' ? `${protocol}//${host}` : origin;
}

/**
 * Installs `window.desktop` for a page the macOS shell hosts in a WKWebView. It runs the same
 * request handling, task cache and provider client as the Electron main process, reaching the
 * service through the shell's relay: HTTP as same-origin fetches the scheme handler forwards, the
 * stream over virtual sockets. Host abilities go through native calls. Only the panel owns the
 * global shortcuts and the language push; each window publishes its own drag regions.
 *
 * Not wired yet: file search (`files` stays absent until the service serves it) and attachments
 * the shell imports from drops and pastes (`resources.imported` has no composer entry point).
 */
export async function installNativeHost(
  native: NativeBridge,
  surface: 'panel' | 'settings',
): Promise<void> {
  const connection = new NativeConnection({
    baseUrl: pageOrigin(),
    relay: true,
    transport: nativeSocketTransport(native),
  });
  const messages = windowMessages();
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
  const settings = nativeSettings(connection, messages, native);
  let latest = await settings.bridge.get();
  const commands = new NativeCommands(connection, native, () => {
    requests.broadcast();
    shortcuts?.sync();
  });
  const requests = new AgentRequests<'page'>(
    connection,
    commands,
    nativePlatform(native, (prepared, autoRun) => emit('launch', { prepared, autoRun })),
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
  const shortcuts =
    surface === 'panel'
      ? nativeShortcuts(native, commands, {
          panelShortcut: () => latest.shortcuts.togglePanel,
          applied: (shortcutAvailable) => {
            settings.setShell({ shortcutAvailable });
            requests.broadcast();
          },
          launch: (prepared, autoRun) => emit('launch', { prepared, autoRun }),
        })
      : null;
  settings.bridge.onChange((next) => {
    const changedShortcut = next.shortcuts.togglePanel !== latest.shortcuts.togglePanel;
    const changedLanguage = next.language !== latest.language;
    latest = next;
    if (surface !== 'panel') return;
    if (changedShortcut) shortcuts?.sync();
    if (changedLanguage) native.post('language.set', { language: next.language });
  });

  connection.onInvalidate((frame) => void requests.onInvalidate(frame));
  connection.onConnected(() => void commands.refreshFromService().catch(() => undefined));
  messages.listen((message) => {
    if (message.type === 'commandSession') {
      const name = commands.list().find((item) => item.id === message.commandId)?.name ?? '';
      emit('session', { commandId: message.commandId, name });
      void native.call('window.show', {});
    } else if (message.type === 'extensionSession') {
      // A window running an older build can post this too: drop a message the panel cannot seed
      // instead of throwing from the channel listener.
      let session: ExtensionSession;
      try {
        session = parseExtensionSession(message.kind, message.target);
      } catch {
        return;
      }
      emit('extensionSession', session);
      void native.call('window.show', {});
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

  native.on('window.active', ({ active }) => setWindowActive(active));
  native.on('window.visibility', ({ visible }) => setWindowVisible(visible));
  publishDragRegions(native, document.getElementById('root') ?? document.body);
  connection.connect();
  // The service may still be starting: its data follows the stream, and the shell's preferences
  // follow `app.state`, both through settings change events.
  void settings.ready.catch((error: unknown) => {
    console.error('The native shell did not report its window state:', error);
  });
  if (surface === 'panel') {
    native.post('language.set', { language: latest.language });
    shortcuts?.sync();
  }

  const openLink = async (url: string) => void (await native.call('link.open', { url }));
  const bridge: DesktopBridge = {
    runtime: 'native',
    platform: 'darwin',
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
            throw new Error('The app starts and connects the service on its own.');
          default:
            return handleExtensionRequest(connection.options(), request, openLink);
        }
      },
      (listener) => {
        serviceListeners.add(listener);
        return () => serviceListeners.delete(listener);
      },
    ),
    show: async () => void (await native.call('window.show', {})),
    hide: async () => void (await native.call('window.hide', {})),
    getState: async () => ({
      pinned: settings.shell().pinned,
      shortcut: latest.shortcuts.togglePanel,
      shortcutAvailable: settings.shell().shortcutAvailable,
    }),
    setPinned: async (pinned) => {
      const applied = await native.call('window.setPinned', { pinned });
      settings.setShell(applied);
      return applied.pinned;
    },
    setShowInDock: async (show) => {
      const applied = await native.call('app.setShowInDock', { show });
      settings.setShell({ showInDock: applied.show });
      return applied.show;
    },
    setOpenAtLogin: async (open) => {
      const applied = await native.call('app.setOpenAtLogin', { open });
      settings.setShell({ openAtLogin: applied.open });
      return applied.open;
    },
    // Attachments go through the agent bridge (`chooseFiles` → `files.pick`).
    chooseFiles: async () => [],
  };
  window.desktop = bridge;
}
