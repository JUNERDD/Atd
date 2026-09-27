import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Astroid, History, Settings, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { Composer } from './components/composer';
import { IconButton } from './components/icon-button';
import { useOverlayReserve } from './components/use-overlay-footer';
import { ToastHost } from './components/toast';
import { useAppLanguage } from './i18n/use-app-language';
import { agentApi } from './features/agent/use-agent';
import { useTaskPanel } from './features/agent/use-task-panel';
import { CommandLauncher } from './features/agent/command-launcher';
import { CommandInput } from './features/agent/command-input';
import { openCommandSettings } from './features/commands/open-command-settings';
import { Transcript } from './features/agent/transcript/transcript';
import { ChildTranscriptView } from './features/agent/transcript/child-transcript-view';
import {
  SubagentContext,
  useSubagentContextValue,
} from './features/agent/transcript/subagent-context';
import { SessionMenu } from './features/agent/session-menu';
import { TaskHistory } from './features/agent/task-history';
import { ServiceBanner } from './features/service/service-banner';
import { EMPTY_QUEUE, type Block } from '../electron/agent/transcript-schema';
import type { FileRef } from '../electron/agent/task-schema';
import './features/agent/agent.css';

const NO_BLOCKS: Block[] = [];

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
    hidden,
    setHidden,
    pending,
    current,
    child,
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
    title,
    run,
    policy,
    changePolicy,
    requests,
    queue,
  } = useTaskPanel();
  useAppLanguage(snapshot?.language);
  const reserveRef = useOverlayReserve();
  const subagents = useSubagentContextValue(
    (view === 'task' && current.detail?.blocks) || NO_BLOCKS,
    requests,
    child.open,
  );
  const [panelBody, setPanelBody] = useState<HTMLDivElement | null>(null);
  // A stable attach callback, so streamed patches leave the transcript's memoized turns alone; it
  // appends to the draft as of the latest commit.
  const latestDraft = useRef({ draft, changeDraft });
  useLayoutEffect(() => {
    latestDraft.current = { draft, changeDraft };
  });
  const attachToDraft = useCallback((file: FileRef) => {
    const latest = latestDraft.current;
    latest.changeDraft({ ...latest.draft, files: [...latest.draft.files, file] });
  }, []);
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
      <SubagentContext value={subagents}>
        {hidden && (
          <Button className="fixed right-4 bottom-4" onClick={() => setHidden(false)}>
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
              className="header-button -mx-1"
              onClick={newTask}
            >
              <Astroid />
            </IconButton>
            <h1 title={title}>{title}</h1>
            <nav className="header-controls" aria-label={t('header.controlsLabel')}>
              {view === 'task' && current.detail && <SessionMenu detail={current.detail} />}
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
              {/* macOS window management lives in the native traffic lights; the web client is a
                  browser tab with nothing to hide. */}
              {window.desktop?.runtime !== 'web' && platform !== 'darwin' && (
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
          {/* Everything below the header; composer overlays stay inside it. */}
          <div ref={setPanelBody} className="panel-body">
            <ServiceBanner onOpenSettings={() => void openSettings()} />
            {view === 'new' && (
              <ScrollArea
                className="panel-content"
                viewportClassName="overlay-footer-fade"
                viewportRef={reserveRef}
              >
                <section className="panel-content-body welcome">
                  <h2 className="max-w-full truncate" title={t('welcome.title')}>
                    {t('welcome.title')}
                  </h2>
                  <p className="max-w-full truncate" title={t('welcome.subtitle')}>
                    {t('welcome.subtitle')}
                  </p>
                  <CommandLauncher
                    commands={agent.snapshot?.commands ?? []}
                    onChoose={(id) => void chooseCommand(id)}
                  />
                  {!window.desktop && <p className="text-xs">{t('welcome.desktopOnly')}</p>}
                </section>
              </ScrollArea>
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
                key={prepared.command.id}
                prepared={prepared}
                onChange={(input) => setPrepared({ ...prepared, input })}
                policy={policy}
                onRun={() => submit()}
                onOpenSettings={() => void openCommandSettings(prepared.command.id)}
                pending={pending}
              />
            )}
            {view === 'task' &&
              (current.detail ? (
                <div className="task-stage">
                  <Transcript
                    detail={current.detail}
                    covered={child.childKey !== null}
                    onAttach={attachToDraft}
                    onNewTask={newTask}
                  />
                  {child.childKey && (
                    <ChildTranscriptView
                      key={child.childKey}
                      taskId={current.detail.task.id}
                      taskTitle={current.detail.task.title}
                      childKey={child.childKey}
                      requests={requests}
                      onBack={child.close}
                    />
                  )}
                </div>
              ) : (
                <ScrollArea className="panel-content" viewportClassName="overlay-footer-fade">
                  <section className="panel-content-body">
                    <p className="text-sm text-muted-foreground">
                      {t('header.loadingConversation')}
                    </p>
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
                blocks={view === 'task' ? current.detail?.blocks : undefined}
                context={view === 'task' ? current.detail?.context : null}
                requests={view === 'task' ? requests : []}
                queue={view === 'task' ? queue : EMPTY_QUEUE}
                quickActions={{ newTask, openHistory: () => setView('history') }}
                tasks={agent.snapshot?.tasks ?? []}
                overlayBoundary={panelBody}
                hidden={view === 'task' && child.childKey !== null}
              />
            )}
          </div>
          <ToastHost top={62} />
        </main>
      </SubagentContext>
    </TooltipProvider>
  );
}
