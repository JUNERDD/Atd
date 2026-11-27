import type { AppLanguage } from '@atd/agent-contracts';
import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { documentLanguage } from '../i18n/create.ts';

/**
 * An extension page follows Atd's language setting (D13) in its copy and in `<html lang>`, from the
 * `prefs` of the view the background pushes; `null` until the first view. A layout effect, so the
 * first view never paints in the start-up language: the bundled resources switch synchronously.
 */
export function useAtdLanguage(language: AppLanguage | null): void {
  const { i18n } = useTranslation();
  useLayoutEffect(() => {
    if (!language) return;
    document.documentElement.lang = documentLanguage(language);
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [i18n, language]);
}
