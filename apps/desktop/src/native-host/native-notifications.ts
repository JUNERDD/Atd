import type { NotificationsBridge } from '../client/notifications-contract';
import type { NativeBridge } from '../native-bridge/client';

/**
 * The shell's task notifications. Every setter answers with the state the shell applied. Only the
 * panel's page may report the task it shows (`task.shown`): the shell ignores it from any other
 * window, and the settings window shows no task.
 */
export function nativeNotifications(
  native: NativeBridge,
  surface: 'panel' | 'settings' | 'onboarding' | 'view',
): NotificationsBridge {
  return {
    state: () => native.call('notifications.state', {}),
    set: (change) => native.call('notifications.set', change),
    openSystemSettings: async () =>
      void (await native.call('notifications.openSystemSettings', {})),
    ...(surface === 'panel'
      ? { taskShown: (taskId: string | null) => native.post('task.shown', { taskId }) }
      : {}),
  };
}
