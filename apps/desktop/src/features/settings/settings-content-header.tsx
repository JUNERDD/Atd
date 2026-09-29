import { useCallback, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/icon-button';
import type { SettingsSubpage } from './use-settings-history';

/**
 * Whether the element is scrolled away from its top, read after scrolls and resizes (a shorter
 * page can clamp the offset) so render never reads layout.
 */
function useScrolledFromTop(node: HTMLElement | null): boolean {
  const scrolled = useRef(false);
  const subscribe = useCallback(
    (notify: () => void) => {
      scrolled.current = false;
      if (!node) return () => {};
      const update = () => {
        const next = node.scrollTop > 0;
        if (next === scrolled.current) return;
        scrolled.current = next;
        notify();
      };
      update();
      node.addEventListener('scroll', update, { passive: true });
      const observer = new ResizeObserver(update);
      observer.observe(node);
      if (node.firstElementChild) observer.observe(node.firstElementChild);
      return () => {
        node.removeEventListener('scroll', update);
        observer.disconnect();
      };
    },
    [node],
  );
  return useSyncExternalStore(
    subscribe,
    () => scrolled.current,
    () => false,
  );
}

/**
 * The 52px bar over the settings content: Back and Forward through the settings history, the
 * breadcrumb (section › sub-page) and trailing controls. It drags the window between its controls
 * (`settings-titlebar`, see `native-host/drag-regions.ts`). Content scrolls beneath it, and once
 * it does the bar shows the toolbar glass so the content stays legible under it.
 */
export function SettingsContentHeader({
  scroller,
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
  /** The content viewport that scrolls under the bar. */
  scroller: HTMLElement | null;
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
  const scrolled = useScrolledFromTop(scroller);
  return (
    <header className="settings-content-header" data-scrolled={scrolled || undefined}>
      {/* The glass is an empty layer: no controls, focus rings or overflow on the glass element. */}
      <div className="settings-content-header-glass surface-glass" aria-hidden="true" />
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
              {sectionLabel}
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
