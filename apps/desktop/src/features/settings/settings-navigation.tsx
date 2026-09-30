import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
export const SettingsNavigationContext = createContext<((section: string) => void) | null>(null);
export function useSettingsNavigation() {
  const navigate = useContext(SettingsNavigationContext);
  if (!navigate) throw new Error('Settings navigation requires the settings window.');
  return navigate;
}

/** Opens the Commands section at one command's editor, as a deep link from the task panel does. */
export const SettingsCommandLinkContext = createContext<((commandId: string) => void) | null>(null);
export function useOpenSettingsCommand() {
  const open = useContext(SettingsCommandLinkContext);
  if (!open) throw new Error('Opening a command requires the settings window.');
  return open;
}

/** Whether the enclosing settings section is the one shown; pages outside the window count as shown. */
export const SettingsSectionActiveContext = createContext(true);

/**
 * Runs `reset` while rendering once the enclosing section is left. Sections stay mounted to keep
 * their data, so each page returns its own view state (page history, search, segment) to the
 * initial top-level page here; switching back then shows that page afresh. `reset` may only update
 * the calling component's state.
 */
export function useSettingsSectionExit(reset: () => void) {
  const active = useContext(SettingsSectionActiveContext);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) reset();
  }
}

/**
 * A page that replaces its section's overview (an editor, a plugin's details), as its
 * `SettingsHeading` reports it for the content header's breadcrumb.
 */
export interface SettingsSubpage {
  title: string;
  /** Accessible name of the header's Back while the page is shown, such as "Back to commands". */
  backLabel?: string;
}

/** The shown section's page history, as the content header's Back and Forward drive it. */
export interface SettingsPageControls {
  canGoBack: boolean;
  canGoForward: boolean;
  back: () => void;
  forward: () => void;
}

/** Registers the shown sub-page with the window's content header; see `useSettingsSubpage`. */
export const SettingsSubpageContext = createContext<((page: SettingsSubpage) => () => void) | null>(
  null,
);

/** Registers the shown section's page history with the window; see `useSettingsPageHistory`. */
export const SettingsPageHistoryContext = createContext<
  ((controls: SettingsPageControls) => () => void) | null
>(null);

/**
 * The window's side of a registration context: the latest value registered and not yet removed,
 * so the entering page's registration wins over the leaving page's cleanup in the same commit.
 */
export function useSettingsRegistry<Value>() {
  const [entries, setEntries] = useState<readonly { id: number; value: Value }[]>([]);
  const nextId = useRef(0);
  const register = useCallback((value: Value) => {
    const id = nextId.current++;
    setEntries((current) => [...current, { id, value }]);
    return () => setEntries((current) => current.filter((entry) => entry.id !== id));
  }, []);
  return [entries.at(-1)?.value ?? null, register] as const;
}

/**
 * Reports a sub-page to the settings window while its section is shown: the content header then
 * names the page in its breadcrumb and labels Back for it. The section's page history, not the
 * page, answers Back. `null` reports nothing, as for a section's overview.
 */
export function useSettingsSubpage(page: SettingsSubpage | null) {
  const register = useContext(SettingsSubpageContext);
  const active = useContext(SettingsSectionActiveContext);
  if (page && !register) throw new Error('A settings sub-page requires the settings window.');
  const shown = page !== null && active;
  const title = page?.title;
  const backLabel = page?.backLabel;
  // A layout effect, so the header never paints a page that has just closed or a stale section.
  useLayoutEffect(() => {
    if (!shown || !register || title === undefined) return;
    return register({ title, backLabel });
  }, [register, shown, title, backLabel]);
}
