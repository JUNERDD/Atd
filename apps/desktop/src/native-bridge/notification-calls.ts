/**
 * Task notifications across the native bridge (`contract.ts`). The service queues task notices;
 * the shell decides whether each becomes a system notification from the preferences below, the
 * system permission, and whether the person is looking at that task, which the panel's page
 * reports with `task.shown`. Like the rest of the contract, the export script loads this file with
 * Node's type stripping, so it imports nothing but TypeBox and its sibling contract files (by their
 * `.ts` names) and uses only erasable TypeScript syntax.
 */
import { Type } from 'typebox';
import { Empty } from './primitives.ts';

/**
 * When a finished or failed task notifies: `never`; `whenAway` (the default) unless the panel is
 * shown, key, and showing that task; `always`, even then.
 */
export const TaskFinishedNotifySchema = Type.Union([
  Type.Literal('never'),
  Type.Literal('whenAway'),
  Type.Literal('always'),
]);

/** The shell-owned notification preferences, kept on this Mac only. */
export const NotificationPreferencesSchema = Type.Object(
  {
    finished: TaskFinishedNotifySchema,
    /** Whether a question or an approval nobody answered notifies while the person is away. */
    attention: Type.Boolean(),
    /** Whether notifications, automations' included, play the default sound. */
    sound: Type.Boolean(),
    /**
     * Whether notifications, automations' included, show runtime text (the question, the answer,
     * the error); otherwise they show only fixed wording around the task's or automation's name.
     */
    previews: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** The system's answer for this app: `notDetermined` until the person is asked. */
export const NotificationPermissionSchema = Type.Union([
  Type.Literal('notDetermined'),
  Type.Literal('denied'),
  Type.Literal('allowed'),
]);

export const NotificationStateSchema = Type.Object(
  { preferences: NotificationPreferencesSchema, permission: NotificationPermissionSchema },
  { additionalProperties: false },
);

export const NativeNotificationCalls = {
  /** The preferences and the current system permission; the settings window asks on focus. */
  'notifications.state': { params: Empty, result: NotificationStateSchema },
  /**
   * Changes the given preferences and resolves to the applied state. Turning a notification on
   * while the system has not asked yet asks now, while the person is there to answer.
   */
  'notifications.set': {
    params: Type.Partial(NotificationPreferencesSchema, { additionalProperties: false }),
    result: NotificationStateSchema,
  },
  /** Opens System Settings at this app's notification settings. */
  'notifications.openSystemSettings': { params: Empty, result: Empty },
};

export const NativeNotificationPosts = {
  /**
   * The task the panel's page shows, `null` while it shows none (a new task's empty composer, or
   * the history). Sent on every change and when the page becomes ready. The shell takes it only
   * from the panel and clears that task's delivered notifications.
   */
  'task.shown': Type.Object(
    {
      taskId: Type.Union([
        Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
        Type.Null(),
      ]),
    },
    { additionalProperties: false },
  ),
};
