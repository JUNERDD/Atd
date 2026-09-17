import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Brain, Command, Keyboard, Menu, Plug, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@ai/ui/components/sheet';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { CommandSettings } from '../commands/command-settings';
import { COMMAND_SETTINGS_STORAGE_KEY, isCommandId } from '../commands/open-command-settings';
import { MemorySettings } from '../memory/memory-settings';
import { IconButton } from '../../components/icon-button';
import { ToastHost } from '../../components/toast';
import { useAppLanguage } from '../../i18n/use-app-language';
import '../agent/agent.css';
import { LanguageSelector } from './language-selector';
import { ProviderSettingsForm } from './provider-settings';
import { ShortcutSettings } from './shortcut-settings';
import { useSettingsSnapshot } from './use-settings';
import { SettingsNavigationContext } from './settings-navigation';
import './settings.css';

const sections = [
  { id: 'providers', labelKey: 'nav.providers', icon: Plug },
  { id: 'commands', labelKey: 'nav.commands', icon: Command },
  { id: 'memory', labelKey: 'nav.memory', icon: Brain },
  { id: 'shortcuts', labelKey: 'nav.shortcuts', icon: Keyboard },
] as const;
function subscribeLayout(listener: () => void) {
  const queries = [
    window.matchMedia('(min-width: 480px)'),
    window.matchMedia('(min-width: 760px)'),
  ];
  queries.forEach((query) => query.addEventListener('change', listener));
  return () => queries.forEach((query) => query.removeEventListener('change', listener));
}
const getLayout = () =>
  window.matchMedia('(min-width: 760px)').matches
    ? 'sidebar'
    : window.matchMedia('(min-width: 480px)').matches
      ? 'top'
      : 'drawer';

/** A fresh settings tab can carry its editor target in the URL hash. */
function readCommandIdFromHash(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#settings?')) return null;
  const commandId = new URLSearchParams(hash.slice('#settings?'.length)).get('commandId');
  return isCommandId(commandId) ? commandId : null;
}

export function SettingsWindow() {
  const { t } = useTranslation('settings');
  const { snapshot, loading } = useSettingsSnapshot();
  const [tab, setTab] = useState(() => (readCommandIdFromHash() ? 'commands' : 'providers'));
  const [visited, setVisited] = useState(() =>
    readCommandIdFromHash() ? ['providers', 'commands'] : ['providers'],
  );
  const [commandTarget, setCommandTarget] = useState<{ id: string; nonce: number } | null>(() => {
    const id = readCommandIdFromHash();
    return id ? { id, nonce: 0 } : null;
  });
  const [drawer, setDrawer] = useState(false);
  const drawerContent = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false);
  const layout = useSyncExternalStore(subscribeLayout, getLayout);
  const [previousLayout, setPreviousLayout] = useState(layout);
  if (layout !== previousLayout) {
    setPreviousLayout(layout);
    setDrawer(false);
  }
  const bridge = window.desktop?.settings;
  const preview = !bridge;
  const currentSection = sections.find((section) => section.id === tab) ?? sections[0];
  useAppLanguage(snapshot?.language);
  function navigate(next: string) {
    if (recording || !sections.some((section) => section.id === next)) return;
    setTab(next);
    setDrawer(false);
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
  }
  // The task panel can request the editor for one command, either through the desktop bridge
  // when this window is already open or through storage/URL in the web preview.
  useEffect(() => {
    const show = (commandId: unknown) => {
      if (recording || !isCommandId(commandId)) return;
      setTab('commands');
      setDrawer(false);
      setVisited((current) => (current.includes('commands') ? current : [...current, 'commands']));
      setCommandTarget({ id: commandId, nonce: Date.now() });
    };
    const unsubscribe = window.desktop?.settings.onOpenCommand?.((commandId) => show(commandId));
    const onStorage = (event: StorageEvent) => {
      if (event.key !== COMMAND_SETTINGS_STORAGE_KEY || !event.newValue) return;
      try {
        const parsed: unknown = JSON.parse(event.newValue);
        if (typeof parsed === 'object' && parsed !== null && 'commandId' in parsed)
          show((parsed as { commandId: unknown }).commandId);
      } catch {
        // A foreign tab wrote an unreadable value; the command list stays visible.
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe?.();
      window.removeEventListener('storage', onStorage);
    };
  }, [recording]);
  function navigation() {
    return (
      <nav className="settings-navigation" aria-label={t('nav.label')}>
        {sections.map(({ id, labelKey, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            className="settings-nav-button"
            aria-current={tab === id ? 'page' : undefined}
            disabled={recording}
            onClick={() => navigate(id)}
          >
            <Icon size={16} aria-hidden="true" />
            {t(labelKey)}
          </Button>
        ))}
      </nav>
    );
  }
  if (loading) return <output className="settings-loading">{t('window.loading')}</output>;
  return (
    <TooltipProvider delayDuration={300}>
      <SettingsNavigationContext value={navigate}>
        <div className="settings-window" data-layout={layout}>
          {layout === 'drawer' ? (
            <header className="settings-mobile-bar">
              <span className="settings-native-controls-space" aria-hidden="true" />
              <span className="settings-current-section">{t(currentSection.labelKey)}</span>
              <Sheet open={drawer} onOpenChange={setDrawer}>
                <SheetTrigger asChild>
                  <IconButton
                    label={t('drawer.menu')}
                    aria-label={t('drawer.menuLabel')}
                    disabled={recording}
                  >
                    <Menu />
                  </IconButton>
                </SheetTrigger>
                <SheetContent
                  ref={drawerContent}
                  side="left"
                  showCloseButton={false}
                  className="settings-drawer transition-none data-open:fade-in-100 data-[side=left]:data-open:slide-in-from-left data-closed:fade-out-100 data-[side=left]:data-closed:slide-out-to-left motion-reduce:animate-none"
                  overlayClassName="settings-drawer-overlay duration-200 motion-reduce:animate-none"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    drawerContent.current
                      ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
                      ?.focus();
                  }}
                >
                  <SheetTitle className="sr-only">{t('drawer.title')}</SheetTitle>
                  <SheetDescription className="sr-only">{t('drawer.description')}</SheetDescription>
                  <header className="settings-drawer-header">
                    <span className="settings-native-controls-space" aria-hidden="true" />
                    <SheetClose asChild>
                      <IconButton label={t('drawer.close')} aria-label={t('drawer.closeLabel')}>
                        <X />
                      </IconButton>
                    </SheetClose>
                  </header>
                  <ScrollArea className="settings-drawer-scroll" gutter>
                    {navigation()}
                  </ScrollArea>
                </SheetContent>
              </Sheet>
            </header>
          ) : (
            <aside className="settings-sidebar" aria-label={t('nav.navigationLabel')}>
              <header className="settings-window-controls">
                <span className="settings-native-controls-space" aria-hidden="true" />
              </header>
              {navigation()}
            </aside>
          )}
          <main className="settings-content" aria-label={t('window.label')}>
            <div className="settings-content-header">
              {bridge && snapshot && <LanguageSelector language={snapshot.language} />}
            </div>
            <ScrollArea
              className="settings-scroll-area"
              viewportClassName="settings-scroll-viewport [&>div]:flex!"
            >
              <div className="settings-content-scroll">
                {preview && (
                  <output className="settings-preview-note">{t('window.previewNote')}</output>
                )}
                <div className="settings-page" hidden={tab !== 'providers'}>
                  <ProviderSettingsForm snapshot={snapshot} />
                </div>
                {visited.includes('commands') && (
                  <div className="settings-page" hidden={tab !== 'commands'}>
                    <CommandSettings
                      settings={snapshot}
                      activeCommand={commandTarget}
                      onConsumeActiveCommand={() => setCommandTarget(null)}
                    />
                  </div>
                )}
                {visited.includes('memory') && (
                  <div className="settings-page" hidden={tab !== 'memory'}>
                    <MemorySettings />
                  </div>
                )}
                {visited.includes('shortcuts') && (
                  <div className="settings-page" hidden={tab !== 'shortcuts'}>
                    <ShortcutSettings snapshot={snapshot} onRecordingChange={setRecording} />
                  </div>
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
        <ToastHost top={52} />
      </SettingsNavigationContext>
    </TooltipProvider>
  );
}
