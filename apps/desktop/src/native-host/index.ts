import type { McpApprovalRequestResult } from '@ai/agent-contracts';
import { AgentRequests } from '../client/agent/agent-requests';
import { parseExtensionSession, type ExtensionSession } from '../client/agent/bridge';
import {
  createAgentBridge,
  type AgentChannel,
  type AgentChannelValues,
} from '../client/agent/bridge-client';
import type { DesktopBridge } from '../client/contract';
import { createServiceBridge } from '../client/service/bridge-client';
import { handleExtensionRequest } from '../client/service/extension-requests';
import type { ServiceEvent } from '../client/service/ipc';
import { publishImportedFiles } from '../lib/imported-files';
import type { NativeBridge } from '../native-bridge/client';
import { setReducedTransparency, setWindowActive, setWindowVisible } from '../window-state';
import { publishDragRegions } from './drag-regions';
import { NativeCommands } from './native-commands';
import { NativeConnection } from './native-connection';
import { nativeFiles } from './native-files';
import { nativePlatform } from './native-platform';
import { nativeSettings } from './native-settings';
import { followShortcutState, nativeShortcuts } from './native-shortcuts';
import { nativeSocketTransport } from './socket-transport';
import { windowMessages } from './window-messages';
import { nativeSpeech } from './native-speech';

/**
 * The page's origin, the base of every relayed request: `ai-app://renderer`. WebKit may report a
 * custom scheme's origin as opaque (`"null"`), so it is rebuilt from the scheme and host then.
 */
function pageOrigin(): string {
  const { origin, protocol, host } = window.location;
  return origin === 'null' ? `${protocol}//${host}` : origin;
}

/**
 * Installs `window.desktop` for a page the macOS shell hosts in a WKWebView. It runs the shared
 * request handling, task cache and provider client (`src/client`), reaching the service through
 * the shell's relay: HTTP as same-origin fetches the scheme handler forwards, the
 * stream over virtual sockets. Host abilities go through native calls. Only the panel owns the
 * global shortcuts, the language push, file search and the files the shell imports from drops and
 * pastes; each window publishes its own drag regions and runs the menu's Undo/Redo.
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
    shortcuts?.sync(true);
  });
  const requests = new AgentRequests<'page'>(
    connection,
    commands,
    nativePlatform(native, (prepared, autoRun) => emit('launch', { prepared, autoRun })),
    {
      emit: (event) => emit('changed', event),
      defaultConnectionId: () => settings.providers.overlay()?.defaultConnectionId ?? null,
    },
    (_page, event) => emit('changed', event),
  );
  const shortcutsApplied = (shortcutAvailable: boolean) => {
    settings.setShell({ shortcutAvailable });
    requests.broadcast();
  };
  const shortcuts =
    surface === 'panel'
      ? nativeShortcuts(native, commands, messages, {
          panelShortcut: () => (settings.loaded() ? latest.shortcuts.togglePanel : null),
          applied: shortcutsApplied,
          launch: (prepared, autoRun) => emit('launch', { prepared, autoRun }),
        })
      : null;
  if (surface === 'settings') followShortcutState(messages, commands, shortcutsApplied);
  // The panel speaks for the service's settings only once they loaded: until then the snapshot
  // holds defaults, which could register a shortcut the user replaced.
  let pushedLanguage: string | null = null;
  settings.bridge.onChange((next) => {
    latest = next;
    if (surface !== 'panel' || !settings.loaded()) return;
    shortcuts?.sync();
    if (next.language === pushedLanguage) return;
    pushedLanguage = next.language;
    native.post('language.set', { language: next.language });
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
  native.on('accessibility.reduceTransparency', ({ reduce }) => setReducedTransparency(reduce));
  if (surface === 'panel')
    native.on('resources.imported', ({ resources, failures }) =>
      publishImportedFiles({ files: resources, failures }),
    );
  publishDragRegions(native, document.getElementById('root') ?? document.body);
  connection.connect();
  // The service may still be starting: its data follows the stream, and the shell's preferences
  // follow `app.state`, both through settings change events.
  void settings.ready.catch((error: unknown) => {
    console.error('The native shell did not report its window state:', error);
  });
  const openLink = async (url: string) => void (await native.call('link.open', { url }));
  const bridge: DesktopBridge = {
    platform: 'darwin',
    settings: settings.bridge,
    ...(surface === 'panel' ? { files: nativeFiles(connection) } : {}),
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
            return handleExtensionRequest(connection.options(), request, {
              openExternal: openLink,
              // Swift shows what would run and approves it itself; the page names the server only.
              requestMcpApproval: (serverId): Promise<McpApprovalRequestResult> =>
                native.call('approval.request', { kind: 'mcpServer', serverId }),
            });
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
    share: async (text, anchor) => void (await native.call('share.text', { text, anchor })),
    speech: nativeSpeech(native),
    onEditCommand: (listener) => native.on('edit.command', ({ command }) => listener(command)),
  };
  window.desktop = bridge;
}
