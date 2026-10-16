import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type NotificationState,
} from '../../client/notifications-contract';
import { onWindowActive } from '../../window-state';
import { useSettingsSectionExit } from './settings-navigation';

/** The row an error shows under: the preference that was changed, or the first row for a failed read. */
type ErrorOwner = keyof NotificationPreferences | 'permission';

/**
 * General › Notifications. The shell owns the preferences and the system permission, so the page
 * reads them on mount and whenever the window becomes active again (the person may have changed the
 * permission in System Settings), and a change shows what the shell applied: while it is in flight
 * the controls show the requested value, and a refused or failed change returns to the shell's
 * state with an error under its row. One change runs at a time.
 */
export function useNotificationSettings() {
  const { t } = useTranslation('settings');
  const bridge = window.desktop?.notifications;
  const [state, setState] = useState<NotificationState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requested, setRequested] = useState<Partial<NotificationPreferences> | null>(null);
  const [error, setError] = useState<{ owner: ErrorOwner; message: string } | null>(null);
  // A read that started before a change would overwrite its applied state with an older one.
  const changes = useRef(0);
  useSettingsSectionExit(() => setError(null));

  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    const load = () => {
      const seen = changes.current;
      bridge.state().then(
        (next) => {
          if (!mounted || seen !== changes.current) return;
          setState(next);
          setLoadFailed(false);
        },
        () => {
          if (mounted) setLoadFailed(true);
        },
      );
    };
    load();
    const stop = onWindowActive((active) => {
      if (active) load();
    });
    return () => {
      mounted = false;
      stop();
    };
  }, [bridge]);

  // The handlers report failures in place and reset after the try statement (React Compiler).
  async function change(next: Partial<NotificationPreferences>, owner: ErrorOwner) {
    if (!bridge || !state || requested) return;
    changes.current += 1;
    setError(null);
    setRequested(next);
    try {
      setState(await bridge.set(next));
    } catch {
      setError({ owner, message: t('notifications.errors.save') });
    }
    setRequested(null);
  }

  async function openSystemSettings() {
    if (!bridge) return;
    setError(null);
    try {
      await bridge.openSystemSettings();
    } catch {
      setError({ owner: 'permission', message: t('notifications.errors.openSystemSettings') });
    }
  }

  const loaded = state !== null;
  const errorFor = (owner: ErrorOwner) =>
    error?.owner === owner
      ? error.message
      : owner === 'finished' && loadFailed && !loaded
        ? t('notifications.errors.load')
        : undefined;
  return {
    preferences: { ...(state?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES), ...requested },
    permission: state?.permission ?? null,
    /** Nothing can change before the shell has reported its state. */
    unavailable: !loaded,
    pending: requested !== null,
    errorFor,
    change: (next: Partial<NotificationPreferences>, owner: ErrorOwner) => void change(next, owner),
    openSystemSettings: () => void openSystemSettings(),
  };
}
