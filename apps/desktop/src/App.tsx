import { Astroid, History, Settings, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { Composer } from './components/composer';
import { IconButton } from './components/icon-button';
import { ToastHost } from './components/toast';
import { useAppLanguage } from './i18n/use-app-language';
import { agentApi } from './features/agent/use-agent';
import { useTaskPanel } from './features/agent/use-task-panel';
import { CommandLauncher } from './features/agent/command-launcher';
import { CommandInput } from './features/agent/command-input';
import { openCommandSettings } from './features/commands/open-command-settings';
import { Transcript } from './features/agent/transcript/transcript';
import { SessionMenu } from './features/agent/session-menu';
import { TaskHistory } from './features/agent/task-history';
import { EMPTY_QUEUE } from '../electron/agent/transcript-schema';
import './features/agent/agent.css';

export function App() {
  const { t } = useTranslation('panel');
  const {
    agent,
    snapshot,
    view,
    setView,
    taskId,
    setTaskId,
    prepared,
    setPrepared,
    savedRun,
    hidden,
    setHidden,
    pending,
    current,
    draftKey,
    draftRevision,
    draft,
    shortcuts,
    platform,
    newTask,
    openSettings,
    hide,
    changeDraft,
    chooseCommand,
    submit,
    rerun,
    title,
    run,
    policy,
    changePolicy,
    requests,
    queue,
  } = useTaskPanel();
  useAppLanguage(snapshot?.language);
  const defaultConnection = snapshot?.connections.find(
    (connection) => connection.connectionId === snapshot.defaultConnectionId,
  );
  const selectedModel =
    policy.model ??
    (!policy.useDefaultModel && run && view === 'task'
      ? run.snapshot.model
      : defaultConnection?.defaultModel
        ? { connectionId: defaultConnection.connectionId, modelId: defaultConnection.defaultModel }
        : null);
  return (
    <TooltipProvider delayDuration={350}>
      {hidden && (
        <Button className="restore-panel" onClick={() => setHidden(false)}>
          {t('header.openPanel')}
        </Button>
      )}
      <main
        hidden={hidden}
        className="task-panel"
        aria-label={t('header.panelLabel')}
        data-figma-node="336:1149"
      >
        <header className="panel-header">
          <IconButton
            label={t('header.newChat')}
            className="header-button panel-logo-button"
            onClick={newTask}
          >
            <Astroid />
          </IconButton>
          <h1 title={title}>{title}</h1>
          <nav className="header-controls" aria-label={t('header.controlsLabel')}>
            {view === 'task' && current.detail && <SessionMenu task={current.detail.task} />}
            <IconButton
              label={t('header.tasks')}
              className="header-button"
              aria-pressed={view === 'history'}
              onClick={() => setView(view === 'history' ? 'new' : 'history')}
            >
              <History />
            </IconButton>
            <IconButton
              label={t('header.settings')}
              className="header-button"
              onClick={() => void openSettings()}
            >
              <Settings />
            </IconButton>
            {/* macOS window management lives in the native traffic lights. */}
            {platform !== 'darwin' && (
              <IconButton
                label={t('header.hide')}
                className="header-button"
                onClick={() => void hide()}
              >
                <X />
              </IconButton>
            )}
          </nav>
        </header>
        {view === 'new' && (
          <ScrollArea className="panel-content" viewportClassName="overlay-footer-fade">
            <section className="panel-content-body welcome">
              <h2 className="max-w-full truncate" title={t('welcome.title')}>
                {t('welcome.title')}
              </h2>
              <p className="max-w-full truncate" title={t('welcome.subtitle')}>
                {t('welcome.subtitle')}
              </p>
              <CommandLauncher
                compact
                commands={agent.snapshot?.commands ?? []}
                onChoose={(id) => void chooseCommand(id)}
                onAll={() => setView('commands')}
              />
              {!window.desktop && <p className="text-xs">{t('welcome.desktopOnly')}</p>}
            </section>
          </ScrollArea>
        )}
        {view === 'commands' && (
          <CommandLauncher
            commands={agent.snapshot?.commands ?? []}
            onChoose={(id) => void chooseCommand(id)}
          />
        )}
        {view === 'history' && (
          <TaskHistory
            tasks={agent.snapshot?.tasks ?? []}
            onChoose={(id) => {
              setTaskId(id);
              setView('task');
            }}
          />
        )}
        {view === 'input' && prepared && (
          <CommandInput
            key={`${prepared.command.id}-${savedRun?.runId ?? 'current'}`}
            prepared={prepared}
            onChange={(input) => setPrepared({ ...prepared, input })}
            policy={policy}
            onPolicyChange={changePolicy}
            onRun={() => submit()}
            onOpenSettings={() => void openCommandSettings(prepared.command.id)}
            pending={pending}
          />
        )}
        {view === 'task' &&
          (current.detail ? (
            <Transcript
              detail={current.detail}
              onAttach={(file) => changeDraft({ ...draft, files: [...draft.files, file] })}
              onContinue={() => submit(true)}
              onRerun={rerun}
            />
          ) : (
            <ScrollArea className="panel-content" viewportClassName="overlay-footer-fade">
              <section className="panel-content-body">
                <p className="text-sm text-muted-foreground">{t('header.loadingConversation')}</p>
              </section>
            </ScrollArea>
          ))}
        {(view === 'new' || view === 'task') && (
          <Composer
            key={`composer-${draftKey}-${draftRevision}`}
            draft={draft}
            policy={policy}
            onPolicyChange={changePolicy}
            onChange={changeDraft}
            onSubmit={() => submit()}
            onStop={run && taskId ? () => agentApi().stop(taskId, run.id) : undefined}
            status={view === 'task' ? run?.status : undefined}
            pending={pending}
            followup={view === 'task'}
            shortcuts={shortcuts}
            connections={snapshot?.connections ?? []}
            model={selectedModel}
            onOpenSettings={() => void openSettings()}
            taskId={view === 'task' ? taskId : null}
            runId={run?.id}
            task={view === 'task' ? (current.detail?.task ?? null) : null}
            requests={view === 'task' ? requests : []}
            queue={view === 'task' ? queue : EMPTY_QUEUE}
          />
        )}
        <ToastHost top={62} />
      </main>
    </TooltipProvider>
  );
}
