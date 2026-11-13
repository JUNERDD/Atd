import { useEffect, useRef, useState } from 'react';
import type { SaveLocationKind, SaveLocationState } from '../../client/save-location-contract';
import { onWindowActive } from '../../window-state';
import { useSettingsSectionExit } from './settings-navigation';

/** Sentinel select item value for prompting with a save panel each time instead of a fixed folder. */
export const ASK_EACH_TIME_VALUE = '__ask__';

/** Sentinel select item value that opens the native folder picker instead of selecting a path. */
export const CHOOSE_FOLDER_VALUE = '__choose__';

export interface UseSaveLocationResult {
  readonly available: boolean;
  readonly state: SaveLocationState | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly selectOption: (value: string) => Promise<void>;
  readonly clearError: () => void;
}

const UNAVAILABLE: UseSaveLocationResult = {
  available: false,
  state: null,
  pending: false,
  error: null,
  selectOption: async () => {},
  clearError: () => {},
};

/**
 * Reads and updates a capture surface's save location (`screenshot` or `recording`). Refreshes on
 * mount and whenever the settings window regains focus so folders removed in Finder prune live.
 */
export function useSaveLocation(
  kind: SaveLocationKind,
  saveFailedMessage: string,
): UseSaveLocationResult {
  const bridge = window.desktop?.saveLocation;
  const [state, setState] = useState<SaveLocationState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ignores stale state reads that started before a user-initiated folder change.
  const changes = useRef(0);
  const mounted = useRef(true);
  useSettingsSectionExit(() => setError(null));

  useEffect(() => {
    mounted.current = true;
    if (!bridge) {
      return () => {
        mounted.current = false;
      };
    }
    const load = () => {
      const seen = changes.current;
      bridge.state(kind).then(
        (next) => {
          if (!mounted.current || seen !== changes.current) return;
          setState(next);
        },
        () => {
          // Leave prior state intact if a background refresh fails.
        },
      );
    };
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const stopActive = onWindowActive((active) => {
      if (active) load();
    });
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', onFocus);
      stopActive();
    };
  }, [bridge, kind]);

  if (!bridge) return UNAVAILABLE;

  // Report failures in place and reset after the try statement (React Compiler).
  const selectOption = async (value: string) => {
    if (pending) return;
    changes.current += 1;
    setError(null);
    setPending(true);
    try {
      const next =
        value === ASK_EACH_TIME_VALUE
          ? await bridge.set(kind, null)
          : value === CHOOSE_FOLDER_VALUE
            ? await bridge.pick(kind)
            : await bridge.set(kind, value);
      if (mounted.current) setState(next);
    } catch (reason) {
      if (mounted.current) {
        setError(reason instanceof Error && reason.message ? reason.message : saveFailedMessage);
      }
    }
    if (mounted.current) setPending(false);
  };

  return {
    available: true,
    state,
    pending,
    error,
    selectOption,
    clearError: () => setError(null),
  };
}
