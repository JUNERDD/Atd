import {
  appIconUrl,
  clearAppData,
  deleteApp,
  editApp,
  getApp,
  listApps,
  listAppVersions,
  patchAppGrants,
  renameApp,
  revertApp,
} from '@atd/agent-client';
import { Value } from 'typebox/value';
import { Identifier } from '../client/agent/command-schema';
import type { AppsBridge } from '../client/apps-contract';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeConnection } from './native-connection';
import type { WindowMessages } from './window-messages';

/**
 * Where `showInSettings` leaves the app for a settings window that is not open yet: the shell
 * opens it at the Apps section only, and the windows share the page origin's storage.
 */
const SETTINGS_TARGET_KEY = 'settings.appTarget';

function storeSettingsTarget(appId: string) {
  try {
    window.localStorage.setItem(SETTINGS_TARGET_KEY, appId);
  } catch {
    // Without storage a new settings window opens at the Apps list instead of the app.
  }
}

function takeSettingsTarget(): string | null {
  try {
    const appId = window.localStorage.getItem(SETTINGS_TARGET_KEY);
    window.localStorage.removeItem(SETTINGS_TARGET_KEY);
    return appId;
  } catch {
    return null;
  }
}

/**
 * Reloads open app windows whose app published a new version. The shell reports each window's
 * loaded version (`userApp.state`); after an `apps` invalidation the panel compares it with the
 * app's current version and asks the shell to open the app again, which reloads it. Checks run
 * one at a time, so a burst of invalidations reads the list once per finished check.
 */
function followOpenApps(connection: NativeConnection, native: NativeBridge) {
  const loaded = new Map<string, number | null>();
  native.on('userApp.state', ({ appId, open, version }) => {
    if (open) loaded.set(appId, version);
    else loaded.delete(appId);
  });
  let check: Promise<void> = Promise.resolve();
  async function reloadChanged() {
    if (!loaded.size) return;
    const { apps } = await listApps(connection.options());
    for (const app of apps) {
      const version = loaded.get(app.id);
      if (version === undefined || version === null || version === app.currentVersion) continue;
      await native.call('userApp.open', { appId: app.id });
    }
  }
  connection.onInvalidate((frame) => {
    if (frame.scope !== 'apps') return;
    check = check.then(reloadChanged).catch((error: unknown) => {
      console.error('Open apps could not be reloaded:', error);
    });
  });
}

/**
 * The apps bridge over the relay and the shell. Only the panel reloads open app windows, so one
 * window does it however many are open.
 */
export function nativeApps(
  connection: NativeConnection,
  native: NativeBridge,
  messages: WindowMessages,
  surface: 'panel' | 'settings' | 'onboarding',
): AppsBridge {
  if (surface === 'panel') followOpenApps(connection, native);
  const options = () => connection.options();
  return {
    list: () => listApps(options()),
    get: (appId) => getApp(options(), appId),
    versions: async (appId) => (await listAppVersions(options(), appId)).versions,
    rename: (appId, name) => renameApp(options(), appId, name),
    revert: (appId, version) => revertApp(options(), appId, version),
    edit: async (appId) => (await editApp(options(), appId)).taskId,
    setGrants: (appId, grants) => patchAppGrants(options(), appId, grants),
    clearData: async (appId) => {
      const detail = await clearAppData(options(), appId);
      await native.call('userApp.clearData', { appId, forget: false });
      return detail;
    },
    remove: async (appId) => {
      await deleteApp(options(), appId);
      await native.call('userApp.clearData', { appId, forget: true });
    },
    open: async (appId) => void (await native.call('userApp.open', { appId })),
    widgetPreview: async (appId, widgetId, family) => {
      const { pngBase64 } = await native.call('userApp.widgetPreview', { appId, widgetId, family });
      return `data:image/png;base64,${pngBase64}`;
    },
    iconUrl: (appId, version) => appIconUrl(options(), appId, version),
    showTask: async (taskId) => {
      messages.post({ type: 'openTask', taskId });
      await native.call('window.show', {});
    },
    // A window running an older build can post other shapes: only a task id opens anything.
    onShowTask: (listener) =>
      messages.listen((message) => {
        if (message.type === 'openTask' && Value.Check(Identifier, message.taskId))
          listener(message.taskId);
      }),
    createInPanel: async () => {
      messages.post({ type: 'createApp' });
      await native.call('window.show', {});
    },
    onCreateInPanel: (listener) =>
      messages.listen((message) => {
        if (message.type === 'createApp') listener();
      }),
    showInSettings: async (appId) => {
      // An open settings window takes the message; a new one reads the stored target.
      storeSettingsTarget(appId);
      messages.post({ type: 'openApp', appId });
      await native.call('settings.open', { commandId: null, section: 'apps' });
    },
    onShowInSettings: (listener) => {
      const pending = takeSettingsTarget();
      if (pending) listener(pending);
      return messages.listen((message) => {
        if (message.type !== 'openApp') return;
        takeSettingsTarget();
        listener(message.appId);
      });
    },
    onChange: (listener) => {
      const stopInvalidate = connection.onInvalidate((frame) => {
        if (frame.scope === 'apps') listener();
      });
      const stopConnected = connection.onConnected(listener);
      return () => {
        stopInvalidate();
        stopConnected();
      };
    },
  };
}
