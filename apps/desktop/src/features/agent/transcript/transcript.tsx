import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { TaskDetail } from '../../../../electron/agent/bridge';
import { isActive, type FileRef, type TaskRun } from '../../../../electron/agent/task-schema';
import { TaskFiles } from '../task-files';
import { adaptTranscript, modelNameForRun, type AdaptedTurn } from './adapter';
import { artifactAnchorIds, indexRequests, type RequestIndex } from './turns';
import { PromptMessage } from './prompt-message';
import { ScrollJump } from './scroll-jump';
import { pendingMessageText } from './run-prompt';
import { StatusBar } from './status-bar';
import { TurnHeader } from './turn-header';
import { TurnView } from './turn-view';
import { useTranscriptScroll } from './use-transcript-scroll';

const VISIBLE_TURNS = 20;

function TurnList({
  turns,
  runs,
  artifacts,
  anchors,
  requests,
  live,
  onAttach,
}: {
  turns: AdaptedTurn[];
  runs: TaskRun[];
  artifacts: TaskDetail['artifacts'];
  anchors: Set<string>;
  requests: RequestIndex;
  live: boolean;
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  const [visibleCount, setVisibleCount] = useState(VISIBLE_TURNS);
  const firstVisible = Math.max(0, turns.length - visibleCount);
  const visibleTurns = turns.slice(firstVisible);
  return (
    <>
      {firstVisible > 0 && (
        <div className="load-earlier">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((count) => count + VISIBLE_TURNS)}
          >
            {firstVisible === 1
              ? t('transcript.loadEarlier.action')
              : t('transcript.loadEarlier.actionWithCount', { count: firstVisible })}
          </Button>
        </div>
      )}
      {visibleTurns.map((turn, index) => (
        <TurnView
          key={turn.id}
          turn={turn}
          runs={runs}
          artifacts={artifacts}
          anchors={anchors}
          requests={requests}
          live={live}
          last={firstVisible + index === turns.length - 1}
          onAttach={onAttach}
        />
      ))}
    </>
  );
}

/**
 * The task's conversation. `covered` keeps it laid out but invisible and inert while a subagent's
 * drill-in view sits on top, so expanded rows, loaded turns and the scroll offset survive the
 * round trip without being restored by hand (a `display: none` box would drop the offset).
 */
export function Transcript({
  detail,
  covered = false,
  onAttach,
}: {
  detail: TaskDetail;
  covered?: boolean;
  onAttach: (file: FileRef) => void;
}): ReactElement {
  const { t } = useTranslation('tasks');
  const { t: tPanel } = useTranslation('panel');
  const { task, blocks, artifacts, requests } = detail;
  const run = task.runs.at(-1);
  const live = isActive(run?.status);
  const requestIndex = useMemo(() => indexRequests(requests), [requests]);
  // Renderer-side reshape after the patch apply: the patched blocks, request index, and runs only
  // change when a new revision lands, so this memo holds the 40ms patch cadence at bay.
  const turns = useMemo(
    () => adaptTranscript(blocks, requestIndex, task.runs),
    [blocks, requestIndex, task.runs],
  );
  const anchors = useMemo(() => artifactAnchorIds(blocks, artifacts), [blocks, artifacts]);
  const { viewportRef, showJump, pin, onScroll } = useTranscriptScroll(detail.revision);
  const hasUser = blocks.some((block) => block.kind === 'user');
  const pendingFiles = !hasUser && run ? artifacts.filter((file) => file.runId === run.id) : [];
  const headRequest = requests[0];

  return (
    <div className="conversation" data-covered={covered || undefined} inert={covered}>
      <ScrollArea
        viewportRef={viewportRef}
        className="flex-1 min-h-0"
        viewportClassName="overlay-footer-fade"
        viewportProps={{ onScroll }}
      >
        <div className="conversation-messages">
          {task.legacy && (
            <div className="legacy-note">
              <p className="text-sm">{t('conversation.legacyTitle')}</p>
              <ScrollArea className="input-preview" viewportClassName="max-h-[inherit]">
                <div>{task.legacy.prompt}</div>
              </ScrollArea>
              {task.legacy.attachments.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('conversation.legacyAttachments', {
                    files: task.legacy.attachments.map((file) => file.name).join(', '),
                  })}
                </p>
              )}
            </div>
          )}
          {!hasUser && run && (
            <section className="transcript-turn">
              <article className="user-message" aria-label={t('conversation.yourMessage')}>
                <PromptMessage
                  snapshot={run.snapshot}
                  fallback={pendingMessageText(run.snapshot)}
                />
              </article>
            </section>
          )}
          <TurnList
            key={task.id}
            turns={turns}
            runs={task.runs}
            artifacts={artifacts}
            anchors={anchors}
            requests={requestIndex}
            live={live}
            onAttach={onAttach}
          />
          {turns.length === 0 && live && (
            <TurnHeader
              startedAt={null}
              durationMs={null}
              modelName={modelNameForRun(run)}
              live
              waiting={headRequest?.kind === 'input' ? 'answer' : headRequest ? 'approval' : null}
            />
          )}
          {pendingFiles.length > 0 && <TaskFiles files={pendingFiles} onAttach={onAttach} />}
          {(detail.capabilities?.length ?? 0) > 0 && (
            <output className="text-sm text-muted-foreground">
              {tPanel('capability.waitingDesktop', {
                capability: detail.capabilities!.map((cap) => cap.capability).join(', '),
              })}
            </output>
          )}
          <StatusBar run={run} />
        </div>
      </ScrollArea>
      <ScrollJump show={showJump} onJump={pin} />
    </div>
  );
}
