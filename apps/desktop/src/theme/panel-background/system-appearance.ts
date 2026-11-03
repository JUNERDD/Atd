import { useSyncExternalStore } from 'react';
import type { EventPayload } from '../../native-bridge/client';
import { DEFAULT_ACCENT_COLOR } from './derive';

/**
 * The system facts the panel background derives from beyond the setting (`appearance.system`):
 * the accent color the `accent` tint takes its hue from, and whether the windows stand on Liquid
 * Glass, whose variant, blur and refraction the setting changes. Until the shell reports, the
 * macOS default accent and no Liquid Glass.
 */
export type SystemAppearance = EventPayload<'appearance.system'>;

let current: SystemAppearance = { accentColor: DEFAULT_ACCENT_COLOR, liquidGlass: false };
const listeners = new Set<() => void>();

export function setSystemAppearance(next: SystemAppearance) {
  if (next.accentColor === current.accentColor && next.liquidGlass === current.liquidGlass) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The latest report, redrawing the caller on each change. */
export function useSystemAppearance(): SystemAppearance {
  return useSyncExternalStore(subscribe, () => current);
}

/** The latest report, for code outside React (the shell push). */
export function systemAppearance(): SystemAppearance {
  return current;
}

/** Every change of the report; returns the unsubscribe. */
export function onSystemAppearance(listener: () => void): () => void {
  return subscribe(listener);
}
