import { useEffect } from 'react';
import type { AppLanguage } from '../../electron/settings-contract';
import i18n from './index';

/**
 * Applies the persisted language once the settings snapshot arrives. Both renderer
 * windows mount this so a change reaches every open window without a reload.
 */
export function useAppLanguage(language: AppLanguage | undefined) {
  useEffect(() => {
    if (language && i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
  }, [language]);
}
