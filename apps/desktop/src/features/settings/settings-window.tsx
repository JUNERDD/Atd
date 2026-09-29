import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Blocks, Brain, Command, Keyboard, Menu, Plug, Shield, X } from 'lucide-react';
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
} from './settings-navigation';
import './settings.css';

const sections = [
  { id: 'permissions', labelKey: 'nav.permissions', icon: Shield },
  { id: 'extensions', labelKey: 'nav.extensions', icon: Blocks },
  { id: 'providers', labelKey: 'nav.providers', icon: Plug },
  { id: 'commands', labelKey: 'nav.commands', icon: Command },
  { id: 'memory', labelKey: 'nav.memory', icon: Brain },
  { id: 'shortcuts', labelKey: 'nav.shortcuts', icon: Keyboard },
] as const;
type SectionId = (typeof sections)[number]['id'];
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
  const [tab, setTab] = useState(() => (readCommandIdFromHash() ? 'commands' : 'permissions'));
  const [visited, setVisited] = useState(() =>
    readCommandIdFromHash() ? ['permissions', 'commands'] : ['permissions'],
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
  const currentSection = sections.find((section) => section.id === tab) ?? sections[0];
  useAppLanguage(snapshot?.language);
  function navigate(next: string) {
    if (recording || !sections.some((section) => section.id === next)) return;
    // A command deep link belongs to the visit that opened it; returning shows the command list.
    if (next !== tab) setCommandTarget(null);
    setTab(next);
    setDrawer(false);
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
  }
  /** Shows one command's editor; the task panel and plugin pages link to commands this way. */
  const showCommand = useCallback(
    (commandId: unknown) => {
      if (recording || !isCommandId(commandId)) return;
      setTab('commands');
      setDrawer(false);
      setVisited((current) => (current.includes('commands') ? current : [...current, 'commands']));
      setCommandTarget({ id: commandId, nonce: Date.now() });
    },
    [recording],
  );
  // The task panel can request the editor for one command, either through the desktop bridge
  // when this window is already open or through storage/URL in the web preview.
  useEffect(() => {
    const unsubscribe = window.desktop?.settings.onOpenCommand?.((commandId) =>
      showCommand(commandId),
    );
    const onStorage = (event: StorageEvent) => {
      if (event.key !== COMMAND_SETTINGS_STORAGE_KEY || !event.newValue) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.newValue);
      } catch {
        // A foreign tab wrote an unreadable value; the command list stays visible.
        return;
      }
      if (typeof parsed === 'object' && parsed !== null && 'commandId' in parsed)
        showCommand((parsed as { commandId: unknown }).commandId);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe?.();
      window.removeEventListener('storage', onStorage);
    };
  }, [showCommand]);
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
  /** Mounts a section on its first visit and keeps it mounted, so its data survives switching. */
  function page(id: SectionId, content: ReactNode) {
    if (!visited.includes(id)) return null;
    return (
      <SettingsSectionActiveContext value={tab === id}>
        <div className="settings-page" hidden={tab !== id}>
          {content}
        </div>
      </SettingsSectionActiveContext>
    );
  }
  if (loading) return <output className="settings-loading">{t('window.loading')}</output>;
  return (
    <TooltipProvider delayDuration={300}>
      <SettingsNavigationContext value={navigate}>
        <SettingsCommandLinkContext value={showCommand}>
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
                    <SheetDescription className="sr-only">
                      {t('drawer.description')}
                    </SheetDescription>
                    <header className="settings-drawer-header">
                      <span className="settings-native-controls-space" aria-hidden="true" />
                      <SheetClose asChild>
                        <IconButton label={t('drawer.close')} aria-label={t('drawer.closeLabel')}>
                          <X />
                        </IconButton>
                      </SheetClose>
                    </header>
                    <ScrollArea className="settings-drawer-scroll" gutter="stable">
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
                className="flex-1"
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
        </SettingsCommandLinkContext>
      </SettingsNavigationContext>
    </TooltipProvider>
  );
}
