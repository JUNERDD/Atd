import { useEffect, useState } from 'react';
import { Button } from '@ai/ui/components/button';
import { Switch } from '@ai/ui/components/switch';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import type { DesktopState } from '../electron/contract';
import { Composer } from './components/composer';
import { Icon } from './components/icon';
import { IconButton } from './components/icon-button';
import { createTask, fileSize, loadState, MAX_TASKS, saveState, taskTitle } from './lib/task-store';
import type { Attachment, Task } from './lib/task-store';

type View = 'new' | 'history' | 'settings' | 'task';

export function App() {
  const [saved, setSaved] = useState(loadState);
  const [view, setView] = useState<View>('new');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState('');
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null);
  const [pinPending, setPinPending] = useState(false);
  const [initialPinned] = useState(saved.pinned);

  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    let cancelled = false;
    void desktop
      .setPinned(initialPinned)
      .then(() => desktop.getState())
      .then((state) => {
        if (!cancelled) setDesktopState(state);
      })
      .catch(() => {
        if (!cancelled) setNotice('Window settings are temporarily unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, [initialPinned]);

  async function hide() {
    if (window.desktop) {
      try {
        await window.desktop.hide();
      } catch {
        setNotice('Could not hide the panel. Please try again.');
      }
    } else setHidden(true);
  }

  useEffect(() => {
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (view !== 'new') setView('new');
      else void hide();
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [view]);

  function submit(prompt: string, attachments: Attachment[]) {
    const task = createTask(prompt, attachments);
    if (!task) return;
    const next = { ...saved, tasks: [task, ...saved.tasks].slice(0, MAX_TASKS) };
    setSaved(next);
    setNotice(
      saveState(next)
        ? ''
        : 'Storage is full or unavailable. This task is saved for this session only.',
    );
    setSelectedTask(task);
    setView('task');
  }

  async function setPinned(pinned: boolean) {
    setPinPending(true);
    try {
      const actual = window.desktop ? await window.desktop.setPinned(pinned) : pinned;
      const next = { ...saved, pinned: actual };
      setSaved(next);
      setNotice(saveState(next) ? '' : 'This setting could not be saved to this device.');
      if (desktopState) setDesktopState({ ...desktopState, pinned: actual });
    } catch {
      setNotice('Could not change the window setting. Please try again.');
    } finally {
      setPinPending(false);
    }
  }

  const title = view === 'history' ? 'Tasks' : view === 'settings' ? 'Settings' : 'New task';

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
              aria-pressed={view === 'history'}
              onClick={() => setView(view === 'history' ? 'new' : 'history')}
            >
              <Icon name="history" />
            </IconButton>
            <IconButton
              label="Settings"
              className="header-button"
              aria-pressed={view === 'settings'}
              onClick={() => setView(view === 'settings' ? 'new' : 'settings')}
            >
              <Icon name="settings" />
            </IconButton>
            <IconButton label="Hide panel" className="header-button" onClick={() => void hide()}>
              <Icon name="close" />
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

        {view === 'settings' && (
          <section className="panel-content secondary-content" aria-label="Panel settings">
            <div className="section-heading">
              <h2>Make it yours</h2>
              <Button variant="ghost" size="sm" onClick={() => setView('new')}>
                Done
              </Button>
            </div>
            <div className="setting-row">
              <div>
                <label htmlFor="always-on-top">Always on top</label>
                <p>Keep the panel within reach.</p>
              </div>
              <Switch
                id="always-on-top"
                checked={saved.pinned}
                disabled={pinPending || !window.desktop}
                onCheckedChange={(value) => void setPinned(value)}
              />
            </div>
            {!window.desktop && (
              <p className="setting-note">Open the desktop app to use window settings.</p>
            )}
            <div className="setting-row">
              <div>
                <span>Show or hide panel</span>
                <p>
                  {desktopState?.shortcutAvailable === false
                    ? 'Shortcut in use. Restore from the app menu or taskbar.'
                    : 'A shortcut for a fresh thought.'}
                </p>
              </div>
              <kbd>{desktopState?.shortcut ?? '⌘ / Ctrl ⇧ Space'}</kbd>
            </div>
            <div className="privacy-note">
              <span className="status-dot" /> <span>On this device</span>
              <p>
                Your last 50 tasks and attachment names stay here. File contents are not stored. No
                AI provider is connected.
              </p>
            </div>
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
            <p className="saved-note">
              Saved on this device. Connect an AI provider to run this task.
            </p>
          </section>
        )}

        {notice && <output className="panel-notice">{notice}</output>}
        <div hidden={view === 'history' || view === 'settings'} className="composer-container">
          <Composer onSubmit={submit} />
        </div>
      </main>
    </TooltipProvider>
  );
}
