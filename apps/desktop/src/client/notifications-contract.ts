import type { Static } from 'typebox';
import type {
  NotificationPermissionSchema,
  NotificationPreferencesSchema,
  NotificationStateSchema,
  TaskFinishedNotifySchema,
} from '../native-bridge/notification-calls';

export type TaskFinishedNotify = Static<typeof TaskFinishedNotifySchema>;
export type NotificationPreferences = Static<typeof NotificationPreferencesSchema>;
export type NotificationPermission = Static<typeof NotificationPermissionSchema>;
export type NotificationState = Static<typeof NotificationStateSchema>;

/** The choices of "When a task finishes", in the order the select lists them. */
export const TASK_FINISHED_NOTIFY = [
  'never',
  'whenAway',
  'always',
] as const satisfies readonly TaskFinishedNotify[];

/** The shell's defaults, which the settings page shows until the shell reports its own. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  finished: 'whenAway',
  attention: true,
  sound: true,
  previews: true,
};

/**
 * The shell's task notifications. The preferences live on this Mac only and the system owns the
 * permission, so every answer is the state the shell applied, which the page shows instead of what
 * it asked for.
 */
export interface NotificationsBridge {
  /** The preferences and the current system permission. */
  state(): Promise<NotificationState>;
  /**
   * Changes the given preferences and resolves to the applied state. Turning a notification on
   * while the system has not asked yet asks now, while the person is there to answer.
   */
  set(change: Partial<NotificationPreferences>): Promise<NotificationState>;
  /** Opens System Settings at this app's notification settings. */
  openSystemSettings(): Promise<void>;
  /**
   * The task the panel shows, `null` while it shows none, so the shell does not notify about a task
   * the person is looking at. Panel only; absent in the other windows.
   */
  taskShown?(taskId: string | null): void;
}
