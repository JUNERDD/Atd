import { createContext, useContext, useState } from 'react';
export const SettingsNavigationContext = createContext<((section: string) => void) | null>(null);
export function useSettingsNavigation() {
  const navigate = useContext(SettingsNavigationContext);
  if (!navigate) throw new Error('Settings navigation requires the settings window.');
  return navigate;
}

/** Whether the enclosing settings section is the one shown; pages outside the window count as shown. */
export const SettingsSectionActiveContext = createContext(true);

/**
 * Runs `reset` while rendering once the enclosing section is left. Sections stay mounted to keep
 * their data, so each page returns its own view state (sub-page, search, segment) to the initial
 * top-level page here; switching back then shows that page afresh. `reset` may only update the
 * calling component's state.
 */
export function useSettingsSectionExit(reset: () => void) {
  const active = useContext(SettingsSectionActiveContext);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) reset();
  }
}
