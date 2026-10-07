import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/icon-button';
import type { SettingsSubpage } from './settings-navigation';

/**
 * The 52px bar over the settings content: Back and Forward through the shown section's page
 * history (`useSettingsPageHistory`), the breadcrumb (section › sub-page) and trailing controls.
 * It drags the window between its controls (`settings-titlebar`, see
 * `native-host/drag-regions.ts`). It sits above the scrolling content rather than over it, so it
 * needs no material or divider of its own.
 */
export function SettingsContentHeader({
  sectionLabel,
  subpage,
  canGoBack,
  canGoForward,
  disabled,
  onBack,
  onForward,
  leading,
  trailing,
}: {
  sectionLabel: string;
  subpage: SettingsSubpage | null;
  canGoBack: boolean;
  canGoForward: boolean;
  disabled: boolean;
  onBack: () => void;
  onForward: () => void;
  /** The drawer's menu button, below 480px. */
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation('settings');
  return (
    <header className="settings-content-header">
      <div className="settings-content-header-bar settings-titlebar">
        {leading}
        <IconButton
          label={t('header.back')}
          aria-label={subpage?.backLabel ?? t('header.back')}
          disabled={disabled || !canGoBack}
          onClick={onBack}
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          label={t('header.forward')}
          disabled={disabled || !canGoForward}
          onClick={onForward}
        >
          <ChevronRight />
        </IconButton>
        <nav className="settings-breadcrumb" aria-label={t('header.location')}>
          <ol>
            <li aria-current={subpage ? undefined : 'page'} title={sectionLabel}>
              <span>{sectionLabel}</span>
            </li>
            {subpage && (
              <li aria-current="page" title={subpage.title}>
                <ChevronRight aria-hidden="true" />
                <span>{subpage.title}</span>
              </li>
            )}
          </ol>
        </nav>
        {trailing}
      </div>
    </header>
  );
}
