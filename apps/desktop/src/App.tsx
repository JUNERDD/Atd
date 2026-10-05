import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { Composer } from './components/composer';
import { FileDropOverlay } from './components/file-drop-overlay';
import { useOverlayReserve } from './components/use-overlay-footer';
import { ToastHost } from './components/toast';
import { useAppLanguage } from './i18n/use-app-language';
import { focusPanelInput, showPanel } from './features/agent/use-panel-window';
import { useScreenshotShortcut } from './features/agent/use-screenshot-shortcut';
import { useSelectionAsk } from './features/agent/use-selection-ask';
import { useTaskPanel } from './features/agent/use-task-panel';
import { CommandLauncher } from './features/agent/command-launcher';
import { CommandInput } from './features/agent/command-input';
import { openCommandSettings } from './features/commands/open-command-settings';
import { Transcript } from './features/agent/transcript/transcript';
import { ChildTranscriptView } from './features/agent/transcript/child-transcript-view';
import { CodeHighlightPool } from './features/agent/transcript/code-highlight-pool';
import {
  SubagentContext,
  useSubagentContextValue,
} from './features/agent/transcript/subagent-context';
import { PanelHeader } from './features/agent/panel-header';
import { SideChatLayer } from './features/agent/side-chat/side-chat-layer';
import { SideChatContext, sideChatItems } from './features/agent/side-chat/side-chats';
import { TaskHistory } from './features/agent/task-history';
import { AppEntries } from './features/apps/app-entries';
import { AppsView } from './features/apps/apps-view';
import { useApps } from './features/apps/use-apps';
import { useConsentArrivals } from './features/apps/use-consent-arrivals';
import { ServiceBanner } from './features/service/service-banner';
import { ServiceStarting } from './features/service/service-starting';
import { useServiceStarting } from './features/service/use-service-starting';
import { MAX_ATTACHMENTS, type QuoteSource } from '@atd/agent-contracts';
import type { Block } from './client/agent/transcript-schema';
import { appendChip, quoteChip } from './features/composer-editor/draft';
import { draftFiles } from './features/composer-editor/draft-attachments';
import type { FileRef } from './client/agent/task-schema';
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
    prepared,
    setPrepared,
    pending,
    current,
    child,
    side,
    draftKey,
    draftRevision,
    draft,
    shortcuts,
    newTask,
    openTask,
    remember,
    createApp,
    openSettings,
    changeDraft,
    chooseCommand,
    submit,
    title,
    policy,
    changePolicy,
    model,
    bound,
    requests,
  } = useTaskPanel();
  useAppLanguage(snapshot?.language);
  const starting = useServiceStarting();
  const reserveRef = useOverlayReserve();
  const subagents = useSubagentContextValue(
    (view === 'task' && current.detail?.blocks) || NO_BLOCKS,
    requests,
    child.open,
  );
  // The HUD above the composer lists the conversation's side chats and opens them over it.
  const conversationId = view === 'task' ? taskId : null;
  const tasks = agent.snapshot?.tasks;
  const sideChats = useMemo(
    () =>
      conversationId
        ? {
            items: sideChatItems(tasks ?? [], conversationId),
            current: side.taskId,
            open: side.open,
          }
        : null,
    [conversationId, tasks, side.taskId, side.open],
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
    latest.changeDraft(appendChip(latest.draft, { kind: 'file', file }));
  }, []);
  // The views without a composer give way to the new conversation, whose draft they share, and the
  // views covering it close: subagent views, and a side chat whose command has not started (a
  // started one's composer takes what arrives). The composer then takes focus, so the side chat
  // returns none.
  const showComposer = () => {
    if (side.child.childKey) side.child.close();
    if (side.view && side.view.phase !== 'task') side.dismiss();
    if (child.childKey) child.close();
    if (view === 'history' || view === 'apps' || view === 'input') setView('new');
  };
  useScreenshotShortcut({ draft, changeDraft, showComposer });
  // An app waits on its capability consent, which the composer's HITL view asks for.
  const { consents } = useApps();
  useConsentArrivals(consents, () => {
    showComposer();
    void showPanel();
  });
  // A quote lands as a chip after the draft's content with the caret after it: the editor takes an
  // outside draft in its layout effect with the caret at the end, before the next frame.
  const quoteToDraft = useCallback((markdown: string, source: QuoteSource | undefined) => {
    const latest = latestDraft.current;
    latest.changeDraft(appendChip(latest.draft, quoteChip(markdown, source)));
    requestAnimationFrame(focusPanelInput);
  }, []);
  useSelectionAsk({ quote: (markdown) => quoteToDraft(markdown, undefined), showComposer });
  return (
    <TooltipProvider delayDuration={350}>
      <CodeHighlightPool>
        <main className="task-panel" aria-label={t('header.panelLabel')} data-figma-node="336:1149">
          {/* Until the service first settles nothing in the panel can work, so the loading takes the
              whole panel. macOS keeps its native traffic lights over it. */}
          {starting ? (
            <ServiceStarting />
          ) : (
            <>
              <PanelHeader
                view={view}
                taskId={taskId}
                title={title}
                detail={view === 'task' ? current.detail : null}
                onNewTask={newTask}
                onToggleView={(next) => setView(view === next ? 'new' : next)}
                onOpenSettings={() => void openSettings()}
              />
              {/* Everything below the header; composer overlays stay inside it. */}
              <div ref={setPanelBody} className="panel-body">
                <ServiceBanner onOpenSettings={() => void openSettings()} />
                {view === 'new' && (
                  <ScrollArea
                    className="panel-content"
                    viewportClassName="overlay-footer-fade"
                    gutter="none"
                    scrollShadow
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
                      >
                        {window.desktop?.apps && (
                          <AppEntries onCreate={createApp} onShowApps={() => setView('apps')} />
                        )}
                      </CommandLauncher>
                      {!window.desktop && <p className="text-xs">{t('welcome.desktopOnly')}</p>}
                    </section>
                  </ScrollArea>
                )}
                {view === 'history' && (
                  <TaskHistory tasks={agent.snapshot?.tasks ?? []} onChoose={openTask} />
                )}
                {view === 'apps' && <AppsView onCreate={createApp} onOpenTask={openTask} />}
                {view === 'input' && prepared && (
                  <CommandInput
                    key={prepared.command.id}
                    prepared={prepared}
                    onChange={(input) => setPrepared({ ...prepared, input })}
                    policy={policy}
                    onRun={() => submit()}
                    onOpenSettings={() => void openCommandSettings(prepared.command.id)}
                    pending={pending}
                    connections={snapshot?.connections ?? []}
                    model={model}
                  />
                )}
                {view === 'task' &&
                  (current.detail ? (
                    <div className="task-stage">
                      <SubagentContext value={subagents}>
                        <Transcript
                          detail={current.detail}
                          covered={child.childKey !== null || side.view !== null}
                          onAttach={attachToDraft}
                          onNewTask={newTask}
                          onOpenTask={openTask}
                          onRemember={remember}
                          onQuote={quoteToDraft}
                          onCommand={side.runCommand}
                        />
                        {child.childKey && (
                          <ChildTranscriptView
                            key={child.childKey}
                            taskId={current.detail.task.id}
                            taskTitle={current.detail.task.title}
                            childKey={child.childKey}
                            requests={requests}
                            onBack={child.close}
                            // The composer is hidden under the drill-in, so a quote returns to
                            // it. Its passage stays in the subagent's view, which the chip
                            // cannot reopen.
                            onQuote={(markdown) => {
                              child.close();
                              quoteToDraft(markdown, undefined);
                            }}
                            onRemember={remember}
                            onCommand={side.runCommand}
                          />
                        )}
                      </SubagentContext>
                      {side.view && (
                        <SideChatLayer
                          key={side.view.id}
                          side={side}
                          view={side.view}
                          conversationTitle={current.detail.task.title}
                          policy={policy}
                          pending={pending}
                          connections={snapshot?.connections ?? []}
                          model={model}
                          onAttach={attachToDraft}
                          onQuote={quoteToDraft}
                          onRemember={remember}
                          onOpenTask={openTask}
                          onNewTask={newTask}
                        />
                      )}
                    </div>
                  ) : (
                    <ScrollArea
                      className="panel-content"
                      viewportClassName="overlay-footer-fade"
                      gutter="none"
                      scrollShadow
                    >
                      <section className="panel-content-body">
                        <p className="text-sm text-muted-foreground">
                          {t('header.loadingConversation')}
                        </p>
                      </section>
                    </ScrollArea>
                  ))}
                {/* The composer serves the side chat's task while one shows, with its subagents. */}
                {(view === 'new' || view === 'task') && (
                  <SubagentContext value={side.taskId ? side.subagents : subagents}>
                    <SideChatContext value={sideChats}>
                      <Composer
                        key={`composer-${draftKey}-${draftRevision}`}
                        {...bound}
                        draft={draft}
                        policy={policy}
                        onPolicyChange={changePolicy}
                        onChange={changeDraft}
                        onSubmit={() => submit()}
                        pending={pending}
                        followup={view === 'task'}
                        shortcuts={shortcuts}
                        connections={snapshot?.connections ?? []}
                        model={model}
                        onOpenSettings={() => void openSettings()}
                        consents={consents}
                        quickActions={{ newTask, openHistory: () => setView('history') }}
                        tasks={agent.snapshot?.tasks ?? []}
                        overlayBoundary={panelBody}
                      />
                    </SideChatContext>
                  </SubagentContext>
                )}
                {/* Dropped files land in the draft whichever view is open. */}
                <FileDropOverlay room={MAX_ATTACHMENTS - draftFiles(draft).length} />
              </div>
            </>
          )}
          <ToastHost top={65} />
        </main>
      </CodeHighlightPool>
    </TooltipProvider>
  );
}
