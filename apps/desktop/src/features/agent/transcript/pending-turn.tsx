import { useTranslation } from 'react-i18next';
import type { Artifact, FileRef, TaskRun } from '../../../client/agent/task-schema';
import { TaskFiles } from '../task-files';
import { modelNameForRun } from './adapter';
import { PromptMessage } from './prompt-message';
import { pendingMessageText } from './run-prompt';
import { StatusBar } from './status-bar';
import type { TurnWaitingKind } from './turn-header';
import { TurnHeader } from './turn-header';
import { UserMessageActions } from './user-message-actions';

/**
 * The latest run's turn before its prompt reaches the transcript. The service records the run
 * (with its input) as soon as it accepts the submit, but the prompt's user block only exists once
 * the run has started its session and Pi appends the message, which can take seconds (a session
 * rebuild, MCP tool listing, a pre-prompt compaction). Until then the turn is drawn from the run's
 * snapshot, in a real turn's order — the message, the live header, files, then the terminal note —
 * so the real turn replaces it in place.
 */
export function PendingTurn({
  run,
  live,
  waiting,
  files,
  onAttach,
}: {
  run: TaskRun;
  live: boolean;
  waiting: TurnWaitingKind;
  files: Artifact[];
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  return (
    <section className={`transcript-turn${live ? ' transcript-turn-live' : ''}`}>
      <article className="user-message" aria-label={t('conversation.yourMessage')}>
        <PromptMessage snapshot={run.snapshot} fallback={pendingMessageText(run.snapshot)} />
        {/* The real message's row, already in place: Copy works, Edit waits for the message. */}
        <UserMessageActions copyText={pendingMessageText(run.snapshot)} onEdit={null} />
      </article>
      {live && (
        <TurnHeader
          startedAt={Date.parse(run.createdAt)}
          durationMs={null}
          modelName={modelNameForRun(run)}
          live
          waiting={waiting}
        />
      )}
      {files.length > 0 && <TaskFiles files={files} onAttach={onAttach} />}
      <StatusBar run={run} />
    </section>
  );
}
