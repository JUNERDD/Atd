import { downloadResource } from '@atd/agent-client';
import type { McpApprovalRequestResult } from '@atd/agent-contracts';
import { AgentRequests } from '../client/agent/agent-requests';
import {
  AutomationSessionTargetSchema,
  parseExtensionSession,
  type AutomationSessionTarget,
  type ExtensionSession,
} from '../client/agent/session-handoff';
import {
  createAgentBridge,
  type AgentChannel,
  type AgentChannelValues,
} from '../client/agent/bridge-client';
import type { DesktopBridge } from '../client/contract';
import { createServiceBridge } from '../client/service/bridge-client';
import { handleExtensionRequest } from '../client/service/extension-requests';
import type { ServiceEvent } from '../client/service/ipc';
import { parse } from '../client/agent/validation';
import { publishFileDrag } from '../lib/file-drag';
import { publishImportedFiles } from '../lib/imported-files';
import type { NativeBridge } from '../native-bridge/client';
import { setReducedTransparency, setWindowActive, setWindowVisible } from '../window-state';
import { publishDragRegions } from './drag-regions';
import { preferencePusher } from './preference-push';
import { nativeAddons } from './native-addons';
import { nativeApps } from './native-apps';
import { nativeAutomations } from './native-automations';
import { nativeCommandOptions } from './native-command-options';
import { nativeComputer } from './native-computer';
import { NativeCommands } from './native-commands';
import { NativeConnection } from './native-connection';
import { nativeFiles } from './native-files';
import { nativeFolders } from './native-folders';
import { nativeMiniPanel } from './native-mini-panel';
import { nativeNotifications } from './native-notifications';
import { nativeOnboarding, nativeOnboardingTrigger } from './native-onboarding';
import { nativePlatform } from './native-platform';
import { nativeSettings } from './native-settings';
import { nativeShortcutRecording } from './native-shortcut-recording';
import { nativeShellPreferences } from './native-shell-preferences';
import { nativeHeldRequest } from './native-held-request';
import { nativeTaskEvents } from './native-task-events';
import { nativeLightCommand, type PageHolder } from './native-light-command';
import { followShortcutState, nativeShortcuts, type GlobalShortcutState } from './native-shortcuts';
import { nativeSocketTransport } from './socket-transport';
import { windowMessages } from './window-messages';
import { nativeSpeech } from './native-speech';
import { nativeToolbar } from './native-toolbar';
import { nativeAbout, nativeUpdate } from './native-update';
import { nativeViews } from './native-views';
import { nativeDiagnostics } from './native-diagnostics';

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
 * global shortcuts (the screenshot one included), the language push, file search, the files the
 * shell imports from drops and pastes, and opening the welcome guide on a first launch; the
 * settings, welcome guide and view windows hand launches to it. Each window publishes its own drag
 * regions and runs the menu's Undo/Redo.
 */
export async function installNativeHost(
  native: NativeBridge,
  surface: 'panel' | 'settings' | 'onboarding' | 'view',
): Promise<void> {
  // Before the first await: the shell replays `update.state` as soon as the page is ready, and
  // can send an Ask or the mini panel's New task before this host is installed.
  const update = surface === 'panel' ? nativeUpdate(native) : undefined;
  const onSelectionAsk =
    surface === 'panel' ? nativeHeldRequest(native, 'selection.ask') : undefined;
  const onNewTask = surface === 'panel' ? nativeHeldRequest(native, 'task.new') : undefined;
  // Native task navigation and withdrawn queues wait for the panel's view to subscribe.
  const taskEvents = surface === 'panel' ? nativeTaskEvents(native) : {};
  const connection = new NativeConnection({
    baseUrl: pageOrigin(),
    relay: true,
    transport: nativeSocketTransport(native),
  });
  const messages = windowMessages();
  // Subscribes to `userApp.state` before the first await, like `update.state`.
  const apps = nativeApps(connection, native, messages, surface);
  // `computer.state` too: the shell replays it when the page becomes ready.
  const computer = nativeComputer(connection, native);
  const channels: { [C in AgentChannel]: Set<(value: AgentChannelValues[C]) => void> } = {
    changed: new Set(),
    launch: new Set(),
    session: new Set(),
    automationSession: new Set(),
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
  const onboarding = surface === 'panel' ? nativeOnboardingTrigger(native, messages) : undefined;
  settings.onLoadError(() => onboarding?.onUnavailable());
  // Replayed when the page becomes ready, so subscribed before the first await too.
  native.on('accessibility.trust', ({ trusted }) =>
    settings.setShell({ accessibilityTrusted: trusted }),
  );
  native.on('screenRecording.trust', ({ trusted }) =>
    settings.setShell({ screenRecordingTrusted: trusted }),
  );
  native.on('miniPanel.state', ({ shown, openOn }) =>
    settings.setShell({ miniPanelShown: shown, miniPanelOpenOn: openOn }),
  );
  let latest = await settings.bridge.get();
  const commands = new NativeCommands(connection, native, () => {
    requests.broadcast();
    shortcuts?.sync(true);
    toolbar?.sync();
    miniPanel?.sync();
    commandOptions?.sync();
  });
  const requests = new AgentRequests<PageHolder>(
    connection,
    commands,
    nativePlatform(native, (prepared, autoRun) => emit('launch', { prepared, autoRun })),
    {
      emit: (event) => emit('changed', event),
      defaultConnectionId: () => settings.providers.overlay()?.defaultConnectionId ?? null,
    },
    (_page, event) => emit('changed', event),
  );
  const shortcutsApplied = ({ panelAvailable, screenshotAvailable }: GlobalShortcutState) => {
    settings.setShell({
      shortcutAvailable: panelAvailable,
      screenshotShortcutAvailable: screenshotAvailable,
    });
    requests.broadcast();
  };
  const shortcuts =
    surface === 'panel'
      ? nativeShortcuts(native, commands, messages, {
          appShortcuts: () => (settings.loaded() ? latest.shortcuts : null),
          applied: shortcutsApplied,
          launch: (launch) => emit('launch', launch),
        })
      : null;
  if (surface !== 'panel') followShortcutState(messages, commands, shortcutsApplied);
  const toolbar =
    surface === 'panel'
      ? nativeToolbar(native, {
          settings: () => (settings.loaded() ? latest.selectionToolbar : null),
          commands: () => commands.list(),
        })
      : null;
  // The mini panel's list depends on the commands alone, so only a change of the command list
  // pushes it (not the settings the toolbar also follows), and nothing goes out before the
  // service's commands first arrive.
  const miniPanel =
    surface === 'panel' ? nativeMiniPanel(native, { commands: () => commands.list() }) : null;
  // Likewise the options the shell offers, which follow the commands and their remembered values.
  const commandOptions =
    surface === 'panel'
      ? nativeCommandOptions(native, {
          commands: () => commands.list(),
          remember: (id, picked) => commands.rememberPicks(id, picked),
        })
      : null;
  // The panel speaks for the service's settings only once they loaded: until then the snapshot
  // holds defaults, which could register a shortcut the user replaced.
  const pushPreferences = preferencePusher(native);
  settings.bridge.onChange((next) => {
    latest = next;
    if (surface !== 'panel' || !settings.loaded()) return;
    onboarding?.onSettings(next);
    shortcuts?.sync();
    toolbar?.sync();
    pushPreferences(next);
  });

  connection.onInvalidate((frame) => void requests.onInvalidate(frame));
  connection.onConnected(() => void commands.refreshFromService().catch(() => undefined));
  messages.listen((message) => {
    if (message.type === 'launchCommand') {
      void requests.handle(message.request, 'page').catch((error: unknown) => {
        console.error('The command launched from settings could not open:', error);
      });
    } else if (message.type === 'commandSession') {
      const name = commands.list().find((item) => item.id === message.commandId)?.name ?? '';
      emit('session', { commandId: message.commandId, name });
      void native.call('window.show', {});
    } else if (message.type === 'automationSession') {
      // Like an extension session below, a message the panel cannot seed is dropped.
      let automation: AutomationSessionTarget;
      try {
        automation = parse(AutomationSessionTargetSchema, message.automation);
      } catch {
        return;
      }
      emit('automationSession', automation);
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
  if (surface === 'panel') {
    native.on('resources.imported', ({ resources, folders, failures }) =>
      publishImportedFiles({ files: resources, folders, failures }),
    );
    native.on('files.drag', publishFileDrag);
  }
  publishDragRegions(native, document.getElementById('root') ?? document.body);
  connection.connect();
  // The service may still be starting: its data follows the stream, and the shell's preferences
  // follow `app.state`, both through settings change events.
  void settings.ready.catch((error: unknown) => {
    console.error('The native shell did not report its window state:', error);
  });
  const openLink = async (url: string) => void (await native.call('link.open', { url }));
  const bridge: DesktopBridge = {
    ...(surface === 'panel' || surface === 'settings'
      ? { diagnostics: nativeDiagnostics(native) }
      : {}),
    platform: 'darwin',
    beginShortcutRecording: nativeShortcutRecording(native),
    settings: settings.bridge,
    ...(surface === 'panel'
      ? { files: nativeFiles(connection), folders: nativeFolders(connection, native) }
      : {}),
    ...(update ? { update } : {}),
    about: nativeAbout(native),
    addons: nativeAddons(connection),
    apps,
    automations: nativeAutomations(connection, native, messages),
    computer,
    notifications: nativeNotifications(native, surface),
    views: nativeViews(native),
    agent: {
      ...createAgentBridge(async (request) => {
        // Only the panel receives `launch` events, so the other windows hand their launches over.
        if (surface !== 'panel' && request.action === 'launch') {
          messages.post({ type: 'launchCommand', request });
          return null;
        }
        return requests.handle(request, 'page');
      }, listen),
      rememberArguments: (commandId, values, shortcutId) =>
        commands.remember(commandId, values, shortcutId),
      ...(surface === 'panel' ? { light: nativeLightCommand(native, requests) } : {}),
    },
    service: createServiceBridge(
      async (request) => {
        if (request.action === 'status') return connection.status();
        if (
          request.action === 'connect' ||
          request.action === 'disconnect' ||
          request.action === 'startLocal'
        )
          throw new Error('The app starts and connects the service on its own.');
        // Every other action is an extension request.
        return handleExtensionRequest(connection.options(), request, {
          openExternal: openLink,
          // Swift shows what would run and approves it itself; the page names the server only.
          requestMcpApproval: (serverId): Promise<McpApprovalRequestResult> =>
            native.call('approval.request', { kind: 'mcpServer', serverId }),
        });
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
    ...nativeShellPreferences(native, settings),
    // Attachments go through the agent bridge (`chooseFiles` → `files.pick`).
    chooseFiles: async () => [],
    screenshot: () => commands.screenshot(),
    editScreenshot: (resourceId) => commands.editScreenshot(resourceId),
    resource: async (resourceId) => {
      const { bytes, mime } = await downloadResource(connection.options(), resourceId);
      // The client types the bytes over any buffer; a Blob takes an ArrayBuffer-backed copy.
      return new Blob([bytes.slice()], { type: mime });
    },
    share: async (text, anchor) => void (await native.call('share.text', { text, anchor })),
    speech: nativeSpeech(native),
    onEditCommand: (listener) => native.on('edit.command', ({ command }) => listener(command)),
    ...(surface === 'panel'
      ? {
          onScreenshotShortcut: (listener) => native.on('shortcut.screenshot', () => listener()),
        }
      : {}),
    ...(onSelectionAsk ? { onSelectionAsk } : {}),
    ...(onNewTask ? { onNewTask } : {}),
    ...taskEvents,
    ...(surface === 'onboarding'
      ? { onboarding: nativeOnboarding(native, messages, connection) }
      : {}),
  };
  window.desktop = bridge;
}
