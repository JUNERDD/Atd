import {
  Activity,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { CommandSettings } from '../commands/command-settings';
import { MemorySettings } from '../memory/memory-settings';
import { ToastHost } from '../../components/toast';
import { useAppLanguage } from '../../i18n/use-app-language';
import '../agent/agent.css';
import { LanguageSelector } from './language-selector';
import { PermissionSettings } from './permission-settings';
import { ShellAllowlistSettings } from './shell-allowlist-settings';
import { ProviderSettingsForm } from './provider-settings';
import { GeneralSettings } from './general-settings';
import { ServiceSettings } from '../service/service-settings';
import { useSettingsSnapshot } from './use-settings';
import {
  SettingsCommandLinkContext,
  SettingsMemoryLinkContext,
  SettingsNavigationContext,
  SettingsPageHistoryContext,
  SettingsSectionActiveContext,
  SettingsSubpageContext,
  useSettingsRegistry,
  type SettingsPageControls,
  type SettingsSubpage,
} from './settings-navigation';
import { SettingsContentHeader } from './settings-content-header';
import { SettingsDrawer } from './settings-drawer';
import { SettingsNavPanel } from './settings-nav-panel';
import { findSettingsSection, settingsSections, type SettingsSectionId } from './settings-sections';
import {
  SettingsUnsavedChangesContext,
  useSettingsUnsavedChangesGuard,
} from './settings-unsaved-changes';
import { SettingsUnsavedChangesDialog } from './settings-unsaved-changes-dialog';
import { useSettingsKeys } from './use-settings-keys';
import { useSettingsSection } from './use-settings-section';
import './settings.css';

function subscribeLayout(listener: () => void) {
  const queries = [
    window.matchMedia('(min-width: 480px)'),
    window.matchMedia('(min-width: 760px)'),
  ];
  queries.forEach((query) => query.addEventListener('change', listener));
  return () => queries.forEach((query) => query.removeEventListener('change', listener));
}
/** Sidebar from 760px, the navigation card above the content from 480px, a drawer below. */
const getLayout = () =>
  window.matchMedia('(min-width: 760px)').matches
    ? 'sidebar'
    : window.matchMedia('(min-width: 480px)').matches
      ? 'top'
      : 'drawer';

export function SettingsWindow() {
  const { t } = useTranslation('settings');
  const { snapshot, loading, failed, retrying, retry } = useSettingsSnapshot();
  const [subpage, registerSubpage] = useSettingsRegistry<SettingsSubpage>();
  const [pages, registerPages, latestPages] = useSettingsRegistry<SettingsPageControls>();
  const unsaved = useSettingsUnsavedChangesGuard(latestPages);
  const [recording, setRecording] = useState(false);
  const {
    section,
    visited,
    commandTarget,
    memoryTarget,
    drawer,
    setDrawer,
    navigate,
    showCommand,
    showMemory,
  } = useSettingsSection(recording, unsaved.guard.confirmLeave);
  const layout = useSyncExternalStore(subscribeLayout, getLayout);
  const [previousLayout, setPreviousLayout] = useState(layout);
  if (layout !== previousLayout) {
    setPreviousLayout(layout);
    setDrawer(null);
  }
  const bridge = window.desktop?.settings;
  const currentSection = findSettingsSection(section) ?? settingsSections[0];
  useAppLanguage(snapshot?.language);

  // The sections share one scroller: each opens at its top, unless a search reveal scrolls later.
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [section]);

  useSettingsKeys(recording, {
    search: () => {
      if (layout === 'drawer') setDrawer('search');
      else {
        const input = document.querySelector<HTMLInputElement>(
          '.settings-sidebar .settings-search input',
        );
        input?.focus();
        input?.select();
      }
    },
    back: () => {
      if (pages?.canGoBack) pages.back();
    },
    forward: () => {
      if (pages?.canGoForward) pages.forward();
    },
  });

  /**
   * Mounts a section on its first visit and keeps it in the background while another is shown, so
   * its data and state survive switching. A hidden section runs no effects: its subscriptions,
   * header registrations and unsaved-changes reports end, and come back (with fresh data) when it
   * is shown again.
   */
  function page(id: SettingsSectionId, content: ReactNode) {
    if (!visited.includes(id)) return null;
    const shown = section === id;
    return (
      <Activity mode={shown ? 'visible' : 'hidden'}>
        <SettingsSectionActiveContext value={shown}>
          {/* `hidden` lets the layout rules find the shown page (settings.css). */}
          <div className="settings-page" hidden={!shown}>
            {content}
          </div>
        </SettingsSectionActiveContext>
      </Activity>
    );
  }
  const navPanel = (
    <SettingsNavPanel current={section} disabled={recording} onNavigate={navigate} />
  );
  return (
    <TooltipProvider delayDuration={300}>
      <SettingsNavigationContext value={navigate}>
        <SettingsCommandLinkContext value={showCommand}>
          <SettingsMemoryLinkContext value={showMemory}>
            <SettingsSubpageContext value={registerSubpage}>
              <SettingsPageHistoryContext value={registerPages}>
                <SettingsUnsavedChangesContext value={unsaved.guard}>
                  <div className="settings-window" data-layout={layout}>
                    {layout !== 'drawer' && (
                      <aside className="settings-sidebar" aria-label={t('nav.navigationLabel')}>
                        <div className="settings-sidebar-surface" aria-hidden="true" />
                        <div className="settings-sidebar-body">
                          {/* Holds the native traffic lights and drags the window. */}
                          <div className="settings-sidebar-strip settings-titlebar" />
                          {navPanel}
                        </div>
                      </aside>
                    )}
                    <main className="settings-content" aria-label={t('window.label')}>
                      <SettingsContentHeader
                        sectionLabel={t(currentSection.labelKey)}
                        subpage={subpage}
                        canGoBack={pages?.canGoBack ?? false}
                        canGoForward={pages?.canGoForward ?? false}
                        disabled={recording}
                        onBack={() => {
                          if (!recording) pages?.back();
                        }}
                        onForward={() => {
                          if (!recording) pages?.forward();
                        }}
                        leading={
                          layout === 'drawer' && (
                            <SettingsDrawer
                              open={drawer !== null}
                              initialFocus={drawer ?? 'section'}
                              onOpenChange={(open) => setDrawer(open ? 'section' : null)}
                              disabled={recording}
                            >
                              {navPanel}
                            </SettingsDrawer>
                          )
                        }
                        trailing={
                          bridge &&
                          snapshot && (
                            <div className="settings-language">
                              <LanguageSelector language={snapshot.language} />
                            </div>
                          )
                        }
                      />
                      <ScrollArea
                        className="settings-content-scroll-area"
                        viewportClassName="[&>div]:flex! [&>div]:flex-col [&>div]:h-full"
                        viewportRef={viewport}
                        gutter="none"
                        scrollShadow
                      >
                        <div className="settings-content-scroll">
                          {failed && (
                            <div className="settings-load-error">
                              <p className="settings-inline-error" role="alert">
                                <CircleAlert aria-hidden="true" />
                                {t('window.loadError')}
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                aria-disabled={retrying || undefined}
                                aria-busy={retrying || undefined}
                                onClick={retry}
                              >
                                {t('window.retry')}
                              </Button>
                            </div>
                          )}
                          {loading ? (
                            <output className="settings-loading">{t('window.loading')}</output>
                          ) : (
                            <>
                              {page(
                                'permissions',
                                <>
                                  <PermissionSettings snapshot={snapshot} />
                                  <ShellAllowlistSettings snapshot={snapshot} />
                                </>,
                              )}
                              {page('extensions', <ServiceSettings />)}
                              {page('providers', <ProviderSettingsForm snapshot={snapshot} />)}
                              {page(
                                'commands',
                                <CommandSettings
                                  settings={snapshot}
                                  activeCommand={commandTarget}
                                />,
                              )}
                              {page('memory', <MemorySettings activeEntry={memoryTarget} />)}
                              {page(
                                'general',
                                <GeneralSettings
                                  snapshot={snapshot}
                                  onRecordingChange={setRecording}
                                />,
                              )}
                            </>
                          )}
                        </div>
                      </ScrollArea>
                    </main>
                  </div>
                  <SettingsUnsavedChangesDialog
                    open={unsaved.open}
                    onKeepEditing={unsaved.keepEditing}
                    onDiscard={unsaved.discard}
                  />
                  <ToastHost top={52} />
                </SettingsUnsavedChangesContext>
              </SettingsPageHistoryContext>
            </SettingsSubpageContext>
          </SettingsMemoryLinkContext>
        </SettingsCommandLinkContext>
      </SettingsNavigationContext>
    </TooltipProvider>
  );
}
