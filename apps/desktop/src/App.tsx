import { Astroid, History, Settings, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { defaultArguments } from '../electron/agent/command-validation';
import { Composer } from './components/composer';
import { IconButton } from './components/icon-button';
import { agentApi } from './features/agent/use-agent';
import { useTaskPanel } from './features/agent/use-task-panel';
import { CommandLauncher } from './features/agent/command-launcher';
import { CommandInput } from './features/agent/command-input';
import { Conversation } from './features/agent/conversation';
import { TaskHistory } from './features/agent/task-history';
import './features/agent/agent.css';

export function App() {
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
    setSavedRun,
    hidden,
    setHidden,
    notice,
    pending,
    current,
    draftKey,
    draftRevision,
    draft,
    shortcuts,
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
  } = useTaskPanel();
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
          Open task panel
        </Button>
      )}
      <main
        hidden={hidden}
        className="task-panel"
        aria-label="AI task panel"
        data-figma-node="336:1149"
      >
        <header className="panel-header">
          <IconButton
            label="New chat"
            className="header-button panel-logo-button"
            onClick={newTask}
          >
            <Astroid className="size-5" />
          </IconButton>
          <h1 title={title}>{title}</h1>
          <nav className="header-controls" aria-label="Panel controls">
            <IconButton
              label="Tasks"
              className="header-button"
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
          <ScrollArea className="panel-content">
            <section className="panel-content-body welcome">
              <h2 className="max-w-full truncate" title="What can I help with?">
                What can I help with?
              </h2>
              <p className="max-w-full truncate" title="Ask anything, or start with a command.">
                Ask anything, or start with a command.
              </p>
              <CommandLauncher
                compact
                commands={agent.snapshot?.commands ?? []}
                onChoose={(id) => void chooseCommand(id)}
                onAll={() => setView('commands')}
              />
              {!window.desktop && (
                <p className="text-xs">
                  Open the desktop app to run the Agent and manage saved commands.
                </p>
              )}
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
            onNew={newTask}
          />
        )}
        {view === 'input' && prepared && (
          <CommandInput
            key={`${prepared.command.id}-${savedRun?.runId ?? 'current'}`}
            prepared={prepared}
            onChange={(input) => setPrepared({ ...prepared, input })}
            policy={policy}
            onPolicyChange={changePolicy}
            onReload={async () => {
              const latest = await agentApi().prepare(prepared.command.id);
              setPrepared({
                ...latest,
                input: {
                  ...prepared.input,
                  arguments: { ...defaultArguments(latest.command), ...prepared.input.arguments },
                },
                notice: '',
              });
              setSavedRun(null);
            }}
            onRun={() => submit()}
            pending={pending}
          />
        )}
        {view === 'task' &&
          (current.detail ? (
            <Conversation
              key={`conversation-${current.detail.task.id}`}
              detail={current.detail}
              notice={current.notice}
              onDismissNotice={current.dismissNotice}
              onAttach={(file) => changeDraft({ ...draft, files: [...draft.files, file] })}
              onRerun={rerun}
              onContinue={() => submit(true)}
            />
          ) : (
            <ScrollArea className="panel-content">
              <section className="panel-content-body">
                <p className="text-sm text-muted-foreground">Loading conversation…</p>
              </section>
            </ScrollArea>
          ))}
        {(notice || agent.error || current.error) && (
          <ScrollArea className="panel-notice" viewportClassName="panel-notice-viewport">
            <output role="alert">{notice || agent.error || current.error}</output>
          </ScrollArea>
        )}
        {(view === 'new' || view === 'task') && (
          <Composer
            key={`composer-${draftKey}-${draftRevision}`}
            draft={draft}
            policy={policy}
            onPolicyChange={changePolicy}
            onChange={changeDraft}
            onSubmit={() => submit()}
            onStop={run && taskId ? () => agentApi().stop(taskId, run.id) : undefined}
            onContinue={() => submit(true)}
            status={view === 'task' ? run?.status : undefined}
            pending={pending}
            followup={view === 'task'}
            shortcuts={shortcuts}
            connections={snapshot?.connections ?? []}
            model={selectedModel}
            onOpenSettings={() => void openSettings()}
          />
        )}
      </main>
    </TooltipProvider>
  );
}
