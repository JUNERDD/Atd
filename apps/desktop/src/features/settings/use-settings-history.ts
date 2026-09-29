import { useCallback, useRef, useState } from 'react';
import type { SettingsSectionId } from './settings-sections';

/**
 * A page that replaces its section's overview (an editor, a plugin's details), as its
 * `SettingsHeading` reports it. The page owns its own stack; `onBack` leaves it one level.
 */
export interface SettingsSubpage {
  title: string;
  /** Accessible name of the back action, such as "Back to commands". */
  backLabel?: string;
  onBack: () => void;
}

interface History {
  entries: readonly SettingsSectionId[];
  index: number;
}

/**
 * The settings window's navigation history, which the content header's back and forward buttons
 * walk. Sections are history entries; an open sub-page is one step past its section's entry, so
 * Back closes it first and opening one drops the forward entries. Sub-pages cannot be reopened by
 * Forward because each section owns its sub-page state.
 */
export function useSettingsHistory(initial: SettingsSectionId) {
  const [history, setHistory] = useState<History>({ entries: [initial], index: 0 });
  const [subpages, setSubpages] = useState<readonly { id: number; page: SettingsSubpage }[]>([]);
  const nextId = useRef(0);
  const section = history.entries[history.index] ?? initial;
  const subpage = subpages.at(-1)?.page ?? null;

  const push = useCallback((next: SettingsSectionId) => {
    setHistory(({ entries, index }) =>
      entries[index] === next
        ? { entries, index }
        : { entries: [...entries.slice(0, index + 1), next], index: index + 1 },
    );
  }, []);

  /** Called by the shown sub-page's heading; returns its unregister function. */
  const registerSubpage = useCallback((page: SettingsSubpage) => {
    const id = nextId.current++;
    setSubpages((current) => [...current, { id, page }]);
    setHistory((current) =>
      current.index === current.entries.length - 1
        ? current
        : { entries: current.entries.slice(0, current.index + 1), index: current.index },
    );
    return () => setSubpages((current) => current.filter((entry) => entry.id !== id));
  }, []);

  function back() {
    if (subpage) subpage.onBack();
    else setHistory((current) => ({ ...current, index: Math.max(0, current.index - 1) }));
  }

  function forward() {
    setHistory((current) => ({
      ...current,
      index: Math.min(current.entries.length - 1, current.index + 1),
    }));
  }

  return {
    section,
    subpage,
    canGoBack: subpage !== null || history.index > 0,
    canGoForward: subpage === null && history.index < history.entries.length - 1,
    push,
    back,
    forward,
    registerSubpage,
  };
}
