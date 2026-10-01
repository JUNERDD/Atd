import { useEffect } from 'react';
import type { AppLanguage } from '../client/settings-contract';
import { changeAppLanguage } from './index';

/**
 * Applies the persisted language once the settings snapshot arrives. Both renderer
 * windows mount this so a change reaches every open window without a reload.
 */
export function useAppLanguage(language: AppLanguage | undefined) {
  useEffect(() => {
    if (language) void changeAppLanguage(language);
  }, [language]);
}
