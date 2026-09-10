import { useState } from 'react';
import { Astroid, Keyboard, Plug, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@ai/ui/components/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ai/ui/components/tabs';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { ProviderSettingsForm } from './provider-settings';
import { ShortcutSettings } from './shortcut-settings';
import { useSettingsSnapshot } from './use-settings';
import './settings.css';

export function SettingsWindow() {
  const { snapshot, loading, error } = useSettingsSnapshot();
  const [tab, setTab] = useState('providers');
  const [recording, setRecording] = useState(false);
  const preview = !window.desktop?.settings;
  const accountName = snapshot?.account.name;

  return (
    <TooltipProvider delayDuration={300}>
      <Tabs
        className="settings-window"
        orientation="vertical"
        value={tab}
        onValueChange={setTab}
        activationMode="automatic"
      >
        <aside className="settings-sidebar" aria-label="Settings navigation">
          <header className="settings-brand">
            <span className="settings-native-controls-space" aria-hidden="true" />
            <Astroid size={14} aria-hidden="true" />
            <h1>ai</h1>
          </header>
          <TabsList className="settings-navigation" aria-label="Settings sections">
            <TabsTrigger value="providers" disabled={recording}>
              <Plug size={16} aria-hidden="true" />
              Providers
            </TabsTrigger>
            <TabsTrigger value="shortcuts" disabled={recording}>
              <Keyboard size={16} aria-hidden="true" />
              Shortcuts
            </TabsTrigger>
          </TabsList>
          <div className="settings-account">
            <Avatar>
              <AvatarFallback>
                {accountName ? accountName.slice(0, 1).toUpperCase() : <UserRound size={16} />}
              </AvatarFallback>
            </Avatar>
            <span>{accountName ?? (loading ? 'Loading account…' : 'Desktop app')}</span>
          </div>
        </aside>

        <main className="settings-content" aria-label="Settings" aria-busy={loading}>
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
                <TabsContent value="providers" forceMount hidden={tab !== 'providers'}>
                  <ProviderSettingsForm
                    key={snapshot ? 'loaded' : 'unavailable'}
                    provider={snapshot?.provider ?? null}
                  />
                </TabsContent>
                <TabsContent value="shortcuts" forceMount hidden={tab !== 'shortcuts'}>
                  <ShortcutSettings snapshot={snapshot} onRecordingChange={setRecording} />
                </TabsContent>
              </>
            )}
          </div>
        </main>
      </Tabs>
    </TooltipProvider>
  );
}
