import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { SettingsSubpage } from './use-settings-history';
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

/** Registers the shown sub-page with the window's content header; see `useSettingsSubpage`. */
export const SettingsSubpageContext = createContext<((page: SettingsSubpage) => () => void) | null>(
  null,
);

/**
 * Reports a sub-page to the settings window while its section is shown: the content header then
 * offers Back (running `onBack`) and names the page in its breadcrumb, in place of a back button
 * on the page. `null` reports nothing, as for a section's overview.
 */
export function useSettingsSubpage(page: SettingsSubpage | null) {
  const register = useContext(SettingsSubpageContext);
  const active = useContext(SettingsSectionActiveContext);
  if (page && !register) throw new Error('A settings sub-page requires the settings window.');
  // The latest handler runs on Back, so a new `onBack` identity per render does not re-register.
  const onBack = useRef(page?.onBack);
  useLayoutEffect(() => {
    onBack.current = page?.onBack;
  });
  const shown = page !== null && active;
  const title = page?.title;
  const backLabel = page?.backLabel;
  // A layout effect, so the header never paints a page that has just closed or a stale section.
  useLayoutEffect(() => {
    if (!shown || !register || title === undefined) return;
    return register({ title, backLabel, onBack: () => onBack.current?.() });
  }, [register, shown, title, backLabel]);
}
