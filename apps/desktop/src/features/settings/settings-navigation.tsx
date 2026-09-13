import { createContext, useContext } from 'react';
export const SettingsNavigationContext = createContext<((section: string) => void) | null>(null);
export function useSettingsNavigation() {
  const navigate = useContext(SettingsNavigationContext);
  if (!navigate) throw new Error('Settings navigation requires the settings window.');
  return navigate;
}
