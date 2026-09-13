import { useRef, useState, useSyncExternalStore } from 'react';
import { Brain, Command, Keyboard, Menu, Plug, X } from 'lucide-react';
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
import { MemorySettings } from '../memory/memory-settings';
import { IconButton } from '../../components/icon-button';
import '../agent/agent.css';
import { ProviderSettingsForm } from './provider-settings';
import { ShortcutSettings } from './shortcut-settings';
import { useSettingsSnapshot } from './use-settings';
import { SettingsNavigationContext } from './settings-navigation';
import './settings.css';

const sections = [
  { id: 'providers', name: 'Providers', icon: Plug },
  { id: 'commands', name: 'Commands', icon: Command },
  { id: 'memory', name: 'Memory', icon: Brain },
  { id: 'shortcuts', name: 'Shortcuts', icon: Keyboard },
];
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

export function SettingsWindow() {
  const { snapshot, loading, error } = useSettingsSnapshot();
  const [tab, setTab] = useState('providers');
  const [visited, setVisited] = useState(['providers']);
  const [drawer, setDrawer] = useState(false);
  const drawerContent = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false);
  const layout = useSyncExternalStore(subscribeLayout, getLayout);
  const [previousLayout, setPreviousLayout] = useState(layout);
  if (layout !== previousLayout) {
    setPreviousLayout(layout);
    setDrawer(false);
  }
  const preview = !window.desktop?.settings;
  function navigate(next: string) {
    if (recording || !sections.some((section) => section.id === next)) return;
    setTab(next);
    setDrawer(false);
    setVisited((current) => (current.includes(next) ? current : [...current, next]));
  }
  function navigation() {
    return (
      <nav className="settings-navigation" aria-label="Settings sections">
        {sections.map(({ id, name, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            className="settings-nav-button"
            aria-current={tab === id ? 'page' : undefined}
            disabled={recording}
            onClick={() => navigate(id)}
          >
            <Icon size={16} aria-hidden="true" />
            {name}
          </Button>
        ))}
      </nav>
    );
  }
  return (
    <TooltipProvider delayDuration={300}>
      <SettingsNavigationContext value={navigate}>
        <div className="settings-window" data-layout={layout}>
          {layout === 'drawer' ? (
            <header className="settings-mobile-bar">
              <span className="settings-native-controls-space" aria-hidden="true" />
              <span className="settings-current-section">
                {sections.find((section) => section.id === tab)?.name}
              </span>
              <Sheet open={drawer} onOpenChange={setDrawer}>
                <SheetTrigger asChild>
                  <IconButton
                    label="Menu"
                    aria-label="Open settings navigation"
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
                  <SheetTitle className="sr-only">Settings navigation</SheetTitle>
                  <SheetDescription className="sr-only">
                    Choose a settings section.
                  </SheetDescription>
                  <header className="settings-drawer-header">
                    <span className="settings-native-controls-space" aria-hidden="true" />
                    <SheetClose asChild>
                      <IconButton label="Close" aria-label="Close settings navigation">
                        <X />
                      </IconButton>
                    </SheetClose>
                  </header>
                  <ScrollArea className="settings-drawer-scroll">{navigation()}</ScrollArea>
                </SheetContent>
              </Sheet>
            </header>
          ) : (
            <aside className="settings-sidebar" aria-label="Settings navigation">
              <header className="settings-window-controls">
                <span className="settings-native-controls-space" aria-hidden="true" />
              </header>
              {navigation()}
            </aside>
          )}
          <main className="settings-content" aria-label="Settings" aria-busy={loading}>
            <ScrollArea
              className="settings-scroll-area"
              viewportClassName="settings-scroll-viewport [&>div]:flex!"
            >
              <div className="settings-content-scroll">
                {preview && (
                  <output className="settings-preview-note">
                    Open the desktop app to configure providers, shortcuts, and window preferences.
                  </output>
                )}
                {error && (
                  <p className="settings-status" data-error="true" role="alert">
                    {error}
                  </p>
                )}
                {loading ? (
                  <output className="settings-status">Loading settings…</output>
                ) : (
                  <>
                    <div className="settings-page" hidden={tab !== 'providers'}>
                      <ProviderSettingsForm snapshot={snapshot} />
                    </div>
                    {visited.includes('commands') && (
                      <div className="settings-page" hidden={tab !== 'commands'}>
                        <CommandSettings settings={snapshot} />
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
                  </>
                )}
              </div>
            </ScrollArea>
          </main>
        </div>
      </SettingsNavigationContext>
    </TooltipProvider>
  );
}
