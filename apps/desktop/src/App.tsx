import { useEffect, useState } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { History, Settings, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { DEFAULT_SHORTCUTS } from '../electron/settings-contract';
import { Composer } from './components/composer';
import { IconButton } from './components/icon-button';
import { createTask, fileSize, loadState, MAX_TASKS, saveState, taskTitle } from './lib/task-store';
import type { Attachment, Task } from './lib/task-store';
import { useSettingsSnapshot } from './features/settings/use-settings';
import { acceleratorToHotkey } from './lib/shortcuts';

type View = 'new' | 'history' | 'task';

export function App() {
  const [saved, setSaved] = useState(loadState);
  const [view, setView] = useState<View>('new');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState('');
  const [chatSession, setChatSession] = useState(0);
  const { snapshot } = useSettingsSnapshot();
  const shortcuts = snapshot?.shortcuts ?? DEFAULT_SHORTCUTS;
  const pinned = snapshot?.pinned;
  const platform = window.desktop?.platform ?? 'web';
  const hotkeyOptions: Options = {
    delimiter: '|',
    useKey: false,
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: true,
    enabled: (event) => !event.repeat,
    ignoreEventWhen: (event) =>
      event.defaultPrevented || event.isComposing || event.keyCode === 229,
  };

  useHotkeys(
    acceleratorToHotkey(shortcuts.openSettings, platform),
    () => void openSettings(),
    hotkeyOptions,
    [openSettings],
  );
  useHotkeys(acceleratorToHotkey(shortcuts.newConversation, platform), newChat, hotkeyOptions, [
    newChat,
  ]);
  useHotkeys(
    'escape',
    () => {
      if (view !== 'new') setView('new');
      else void hide();
    },
    { ...hotkeyOptions, ignoreModifiers: true, preventDefault: false },
    [view, hide],
  );

  useEffect(() => {
    if (pinned === undefined) return;
    // Keep the legacy cache current while native settings own the saved preference.
    const stored = loadState();
    if (stored.pinned !== pinned) saveState({ ...stored, pinned });
  }, [pinned]);

  async function openSettings() {
    try {
      if (window.desktop) await window.desktop.settings.open();
      else {
        const url = new URL(window.location.href);
        url.hash = 'settings';
        const settings = window.open(url, 'ai-settings', 'width=1000,height=720');
        if (settings) settings.focus();
        else setNotice('Allow pop-ups to open the settings preview.');
      }
    } catch {
      setNotice('Could not open settings. Please try again.');
    }
  }

  async function hide() {
    if (window.desktop) {
      try {
        await window.desktop.hide();
      } catch {
        setNotice('Could not hide the panel. Please try again.');
      }
    } else setHidden(true);
  }

  function submit(prompt: string, attachments: Attachment[]) {
    const task = createTask(prompt, attachments);
    if (!task) return;
    const next = {
      ...saved,
      pinned: pinned ?? saved.pinned,
      tasks: [task, ...saved.tasks].slice(0, MAX_TASKS),
    };
    setSaved(next);
    setNotice(
      saveState(next)
        ? ''
        : 'Storage is full or unavailable. This task is saved for this session only.',
    );
    setSelectedTask(task);
    setView('task');
  }

  function newChat() {
    setView('new');
    setSelectedTask(null);
    setNotice('');
    setChatSession((session) => session + 1);
  }

  const title = view === 'history' ? 'Tasks' : 'New task';

  return (
    <TooltipProvider delayDuration={350}>
      {hidden && (
        <Button className="restore-panel" onClick={() => setHidden(false)}>
          Open task panel
        </Button>
      )}
      <main
        hidden={hidden}
        className="task-panel"
        aria-label="AI task panel"
        data-figma-node="1:400"
      >
        <header className="panel-header">
          <h1>{title}</h1>
          <nav className="header-controls" aria-label="Panel controls">
            <IconButton
              label="Tasks"
              className="header-button"
              variant={view === 'history' ? 'secondary' : 'ghost'}
              aria-pressed={view === 'history'}
              onClick={() => setView(view === 'history' ? 'new' : 'history')}
            >
              <History />
            </IconButton>
            <IconButton
              label="Settings"
              className="header-button"
              onClick={() => void openSettings()}
            >
              <Settings />
            </IconButton>
            <IconButton label="Hide panel" className="header-button" onClick={() => void hide()}>
              <X />
            </IconButton>
          </nav>
        </header>

        {view === 'new' && (
          <section className="panel-content welcome" aria-labelledby="welcome-title">
            <h2 id="welcome-title">What can I help with?</h2>
            <p>A question, a task, a starting point.</p>
          </section>
        )}

        {view === 'history' && (
          <section className="panel-content secondary-content" aria-label="Task history">
            <div className="section-heading">
              <h2>Your tasks</h2>
              <Button variant="ghost" size="sm" onClick={() => setView('new')}>
                New task
              </Button>
            </div>
            {saved.tasks.length === 0 ? (
              <div className="empty-state">
                <p>No tasks yet.</p>
                <p>Your next starting point will appear here.</p>
              </div>
            ) : (
              <ul className="task-list">
                {saved.tasks.map((task) => (
                  <li key={task.id}>
                    <Button
                      variant="ghost"
                      className="task-row"
                      onClick={() => {
                        setSelectedTask(task);
                        setView('task');
                      }}
                    >
                      <span className="task-row-title">{taskTitle(task)}</span>
                      <span className="task-row-meta">
                        <time dateTime={task.createdAt}>
                          {new Date(task.createdAt).toLocaleDateString('en', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </time>
                        <span>Saved locally</span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {view === 'task' && selectedTask && (
          <section className="panel-content secondary-content" aria-label="Saved task">
            <div className="section-heading">
              <h2>Task saved</h2>
              <Button variant="ghost" size="sm" onClick={() => setView('new')}>
                New task
              </Button>
            </div>
            <div className="saved-prompt">{selectedTask.prompt || 'Attached context'}</div>
            {selectedTask.attachments.length > 0 && (
              <ul className="saved-attachments" aria-label="Saved attachments">
                {selectedTask.attachments.map((file) => (
                  <li key={file.id}>
                    <span>{file.name}</span>
                    <span>{fileSize(file.size)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="saved-note">Saved on this device.</p>
          </section>
        )}

        {notice && <output className="panel-notice">{notice}</output>}
        <div hidden={view === 'history'} className="composer-container">
          <Composer
            key={chatSession}
            onSubmit={submit}
            focusOnMount={chatSession > 0}
            shortcuts={shortcuts}
            provider={snapshot?.provider}
            onOpenSettings={() => void openSettings()}
          />
        </div>
      </main>
    </TooltipProvider>
  );
}
