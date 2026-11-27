import { resolveLanguage } from '@atd/agent-contracts';
import { Value } from 'typebox/value';
import { ChromePrefsSchema, type ChromePrefs, type RunView } from '../channel/payloads.ts';
import { STORAGE_KEYS } from '../messages/ports.ts';
import { DEFAULT_SETTINGS, type ExtensionSettings } from '../messages/settings.ts';
import type { Connection, PairingView, ShortcutView } from '../messages/views.ts';

/**
 * The service worker's state as the shell last reported it, plus the channel and pairing as the
 * worker sees them. Surfaces never read it directly: `projection.ts` derives their views, and
 * every change notifies the subscribers (pushes, tab group, badge).
 */
export interface BackgroundState {
  connection: Connection;
  pairing: PairingView;
  /** The shell-verified browser name from `welcome`, when reported. */
  browser: string | undefined;
  /** The prefs Atd last forwarded (kept across sessions), or undefined before Atd ever did. */
  prefs: ChromePrefs | undefined;
  /** Origins the person allowed Atd to act on (the panel's site switch, D6). */
  sites: readonly string[];
  /** The shell's last `runs` snapshot as sent; `projectRuns` adds the disconnected view. */
  runs: readonly RunView[];
  /** The extension's commands with their shortcuts as Chrome last reported them (`commands.ts`). */
  shortcuts: readonly ShortcutView[];
  /** The extension's own settings; only `settings.ts` changes them. */
  settings: ExtensionSettings;
}

type Listener = (state: BackgroundState, previous: BackgroundState) => void;

export class Store {
  private current: BackgroundState = {
    connection: 'connecting',
    pairing: { state: 'unpaired' },
    browser: undefined,
    prefs: undefined,
    sites: [],
    runs: [],
    shortcuts: [],
    settings: DEFAULT_SETTINGS,
  };
  private readonly listeners = new Set<Listener>();

  get state(): BackgroundState {
    return this.current;
  }

  update(patch: Partial<BackgroundState>): void {
    const previous = this.current;
    this.current = { ...previous, ...patch };
    for (const listener of this.listeners) listener(this.current, previous);
  }

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }
}

/**
 * The prefs the surfaces use: Atd's, else Chrome's UI language (resolved the way Atd resolves an
 * unset `language`) with glow effects on, Atd's default.
 */
export function effectivePrefs(prefs: ChromePrefs | undefined): ChromePrefs {
  return prefs ?? { language: resolveLanguage(chrome.i18n.getUILanguage()), glowEffects: true };
}

/** The prefs Atd forwarded in an earlier session, so surfaces start in the right language. */
export async function restorePrefs(): Promise<ChromePrefs | undefined> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.prefs);
  const value: unknown = stored[STORAGE_KEYS.prefs];
  return Value.Check(ChromePrefsSchema, value) ? value : undefined;
}

export function persistPrefs(prefs: ChromePrefs): void {
  const value: ChromePrefs = { language: prefs.language, glowEffects: prefs.glowEffects };
  chrome.storage.local.set({ [STORAGE_KEYS.prefs]: value }).catch((error: unknown) => {
    console.warn('[atd] could not keep the prefs', error);
  });
}
