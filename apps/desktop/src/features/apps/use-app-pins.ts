import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesktopPin } from '../../client/apps-contract';
import { showErrorToast, showToast } from '../../components/toast-store';
import { useSettingsSnapshot } from '../settings/use-settings';
import { appsBridge } from './use-apps';

const NO_PINS: readonly DesktopPin[] = [];
/** Set once the hint that pins need Atd running has shown. */
const LOGIN_HINT_KEY = 'apps.pinLoginHint';
/** Set once people know a card can be dragged out: the hint showed, or they dragged one. */
const DRAG_HINT_KEY = 'apps.pinDragHint';
/** How long a drag out of the panel may take to end in a pin that counts as its outcome. */
const DROP_WAIT_MS = 60_000;

function subscribe(listener: () => void) {
  return window.desktop?.apps?.onPins(listener) ?? (() => undefined);
}

function currentPins() {
  return window.desktop?.apps?.pins() ?? NO_PINS;
}

/** Whether a one-time hint should show now, recording that it did; without storage it never shows. */
function takeHint(key: string) {
  try {
    if (window.localStorage.getItem(key)) return false;
    window.localStorage.setItem(key, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * The apps pinned to the desktop, following the shell, and pinning from the panel: the card's
 * toggle and dragging a card out (`dragOut`). A pin made here is confirmed with a toast, followed
 * by at most one one-time hint: after the first pin made with the toggle, that a card can also be
 * dragged onto the desktop (a drag teaches that by itself); after a later one, where the login
 * item exists but is off, that pins show only while Atd runs. Removing a pin from its own menu on
 * the desktop needs no toast here.
 */
export function useAppPins() {
  const { t } = useTranslation('apps');
  const pins = useSyncExternalStore(subscribe, currentPins);
  const pinned = useMemo(() => new Set(pins.map((pin) => pin.appId)), [pins]);
  const openAtLogin = useSettingsSnapshot().snapshot?.openAtLogin ?? null;
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  /** Apps dragged out of the panel, by id: their name, and until when a new pin counts. */
  const dragged = useRef(new Map<string, { name: string; until: number }>());

  function announce(name: string, via: 'toggle' | 'drag') {
    showToast({ kind: 'info', text: t('pin.added', { name }) });
    // Recorded either way: a drag needs no hint about dragging.
    const firstPin = takeHint(DRAG_HINT_KEY);
    if (firstPin && via === 'toggle') {
      showToast({ kind: 'info', text: t('pin.dragHint') });
    } else if (openAtLogin === false && takeHint(LOGIN_HINT_KEY)) {
      showToast({ kind: 'info', text: t('pin.loginHint') });
    }
  }

  useEffect(() => {
    const now = Date.now();
    for (const [appId, { name, until }] of dragged.current) {
      if (pinned.has(appId)) announce(name, 'drag');
      if (pinned.has(appId) || now > until) dragged.current.delete(appId);
    }
  });

  async function toggle(app: { id: string; name: string }) {
    if (pending.has(app.id)) return;
    const pin = !pinned.has(app.id);
    setPending((current) => new Set(current).add(app.id));
    try {
      if (pin) {
        await appsBridge().pin(app.id);
        announce(app.name, 'toggle');
      } else {
        await appsBridge().unpin(app.id);
        showToast({ kind: 'info', text: t('pin.removed', { name: app.name }) });
      }
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(app.id);
        return next;
      });
    }
  }

  /** A press on the app's card moved: the shell drags its pin out of the panel. */
  function dragOut(app: { id: string; name: string }) {
    if (!pinned.has(app.id))
      dragged.current.set(app.id, { name: app.name, until: Date.now() + DROP_WAIT_MS });
    appsBridge().startPinDrag(app.id);
  }

  return { pinned, pending, toggle, dragOut };
}
