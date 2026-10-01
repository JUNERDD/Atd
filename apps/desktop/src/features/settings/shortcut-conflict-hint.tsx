import { useTranslation } from 'react-i18next';

/**
 * Guidance shown wherever a global shortcut is chosen. The app can report its own duplicates and
 * combinations macOS reserves, but not a combination another app holds, so a silent shortcut is
 * explained here rather than as an error.
 */
export function ShortcutConflictHint() {
  const { t } = useTranslation('common');
  return <p className="settings-field-note">{t('shortcuts.conflictHint')}</p>;
}
