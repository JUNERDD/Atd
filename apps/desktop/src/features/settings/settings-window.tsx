import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { CommandSettings } from '../commands/command-settings';
import { isCommandId } from '../commands/open-command-settings';
import { MemorySettings } from '../memory/memory-settings';
import { ToastHost } from '../../components/toast';
import { useAppLanguage } from '../../i18n/use-app-language';
import '../agent/agent.css';
import { LanguageSelector } from './language-selector';
import { PermissionSettings } from './permission-settings';
import { ShellAllowlistSettings } from './shell-allowlist-settings';
import { ProviderSettingsForm } from './provider-settings';
import { ShortcutSettings } from './shortcut-settings';
import { ServiceSettings } from '../service/service-settings';
import { useSettingsSnapshot } from './use-settings';
import {
  SettingsCommandLinkContext,
  SettingsNavigationContext,
  SettingsSectionActiveContext,
  SettingsSubpageContext,
} from './settings-navigation';
import { SettingsContentHeader } from './settings-content-header';
import { SettingsDrawer } from './settings-drawer';
import { SettingsNavPanel } from './settings-nav-panel';
import { findSettingsSection, settingsSections, type SettingsSectionId } from './settings-sections';
import { useSettingsHistory } from './use-settings-history';
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

/** A new settings window carries its editor target in the URL hash. */
function readCommandIdFromHash(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#settings?')) return null;
  const commandId = new URLSearchParams(hash.slice('#settings?'.length)).get('commandId');
  return isCommandId(commandId) ? commandId : null;
}

export function SettingsWindow() {
  const { t } = useTranslation('settings');
  const { snapshot, loading } = useSettingsSnapshot();
  const history = useSettingsHistory(readCommandIdFromHash() ? 'commands' : 'permissions');
  const { section, push } = history;
  const [visited, setVisited] = useState<readonly SettingsSectionId[]>([section]);
  const [commandTarget, setCommandTarget] = useState<{ id: string; nonce: number } | null>(() => {
    const id = readCommandIdFromHash();
    return id ? { id, nonce: 0 } : null;
  });
  const [drawer, setDrawer] = useState(false);
  const [recording, setRecording] = useState(false);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const layout = useSyncExternalStore(subscribeLayout, getLayout);
  const [previousLayout, setPreviousLayout] = useState(layout);
  if (layout !== previousLayout) {
    setPreviousLayout(layout);
    setDrawer(false);
  }
  // Every way into a section (the list, search, history, a link) mounts it on its first visit.
  if (!visited.includes(section)) setVisited([...visited, section]);
  const bridge = window.desktop?.settings;
  const currentSection = findSettingsSection(section) ?? settingsSections[0];
  useAppLanguage(snapshot?.language);

  const navigate = useCallback(
    (next: string) => {
      const target = findSettingsSection(next);
      if (recording || !target) return;
      // A command deep link belongs to the visit that opened it; returning shows the command list.
      if (target.id !== section) setCommandTarget(null);
      push(target.id);
      setDrawer(false);
    },
    [recording, section, push],
  );
  /** Shows one command's editor; the task panel and plugin pages link to commands this way. */
  const showCommand = useCallback(
    (commandId: unknown) => {
      if (recording || !isCommandId(commandId)) return;
      push('commands');
      setDrawer(false);
      setCommandTarget({ id: commandId, nonce: Date.now() });
    },
    [recording, push],
  );
  // The task panel can request the editor for one command while this window is already open.
  useEffect(
    () => window.desktop?.settings.onOpenCommand?.((commandId) => showCommand(commandId)),
    [showCommand],
  );
  function move(step: () => void) {
    if (recording) return;
    setCommandTarget(null);
    step();
  }

  /** Mounts a section on its first visit and keeps it mounted, so its data survives switching. */
  function page(id: SettingsSectionId, content: ReactNode) {
    if (!visited.includes(id)) return null;
    return (
      <SettingsSectionActiveContext value={section === id}>
        <div className="settings-page" hidden={section !== id}>
          {content}
        </div>
      </SettingsSectionActiveContext>
    );
  }
  if (loading) return <output className="settings-loading">{t('window.loading')}</output>;
  const navPanel = (
    <SettingsNavPanel current={section} disabled={recording} onNavigate={navigate} />
  );
  return (
    <TooltipProvider delayDuration={300}>
      <SettingsNavigationContext value={navigate}>
        <SettingsCommandLinkContext value={showCommand}>
          <SettingsSubpageContext value={history.registerSubpage}>
            <div className="settings-window" data-layout={layout}>
              {layout !== 'drawer' && (
                <aside className="settings-sidebar" aria-label={t('nav.navigationLabel')}>
                  <div className="settings-sidebar-glass surface-glass" aria-hidden="true" />
                  <div className="settings-sidebar-body">
                    {/* Holds the native traffic lights and drags the window. */}
                    <div className="settings-sidebar-strip settings-titlebar" />
                    {navPanel}
                  </div>
                </aside>
              )}
              <main className="settings-content" aria-label={t('window.label')}>
                <SettingsContentHeader
                  scroller={scroller}
                  sectionLabel={t(currentSection.labelKey)}
                  subpage={history.subpage}
                  canGoBack={history.canGoBack}
                  canGoForward={history.canGoForward}
                  disabled={recording}
                  onBack={() => move(history.back)}
                  onForward={() => move(history.forward)}
                  leading={
                    layout === 'drawer' && (
                      <SettingsDrawer open={drawer} onOpenChange={setDrawer} disabled={recording}>
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
                  viewportRef={setScroller}
                  viewportClassName="[&>div]:flex! [&>div]:flex-col [&>div]:h-full"
                  gutter="none"
                >
                  <div className="settings-content-scroll">
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
                        onConsumeActiveCommand={() => setCommandTarget(null)}
                      />,
                    )}
                    {page('memory', <MemorySettings />)}
                    {page(
                      'shortcuts',
                      <ShortcutSettings snapshot={snapshot} onRecordingChange={setRecording} />,
                    )}
                  </div>
                </ScrollArea>
              </main>
            </div>
            <ToastHost top={52} />
          </SettingsSubpageContext>
        </SettingsCommandLinkContext>
      </SettingsNavigationContext>
    </TooltipProvider>
  );
}
