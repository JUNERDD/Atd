import { Reply, Square } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunView } from '../channel/payloads.ts';
import type { PanelMessage } from '../messages/panel.ts';
import { canReply, type SurfaceRun } from '../messages/views.ts';
import type { Reach } from '../pages/link.ts';
import {
  isActiveRun,
  runControl,
  runNeedsPerson,
  runReply,
  runTarget,
  type Conversation,
  type RunTarget,
} from './model.ts';
import { RunReply } from './run-reply.tsx';

type Send = (message: PanelMessage, options?: { close: boolean }) => void;
/** Reply on a conversation: the composer replies to its task from now on. */
type OnReply = (taskId: string) => void;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The tile's letter: the title's first character, as Atd's task list draws it. */
function initialOf(title: string): string {
  const first = graphemes.segment(title).containing(0)?.segment ?? '';
  return first.toLocaleUpperCase();
}

/** What a run is doing right now, in one line under its title. */
function phaseOf(run: RunView, t: TFunction<'panel'>): string {
  switch (run.status) {
    case 'working':
      return run.step || t('runs.working');
    case 'attention':
      return run.requests[0]?.kind === 'confirmation' ? t('runs.waitingOk') : t('runs.waitingYou');
    case 'held':
      return t('runs.held');
    case 'stopping':
      return t('runs.stopping');
    case 'disconnected':
      return t('runs.lost');
    case 'done':
      return t('runs.done');
    case 'failed':
      return run.problem?.message || t('runs.failed');
    case 'stopped':
      return t('runs.stopped');
  }
}

function targetMessage(run: RunView, target: RunTarget): PanelMessage | null {
  if (!target) return null;
  return target.kind === 'tab'
    ? { type: 'tab.show', tabId: target.tabId }
    : { type: 'app.open', taskId: run.taskId };
}

/**
 * A conversation's row: its title (its task's, named after its first request) and what its latest
 * turn is doing, with that turn's control.
 */
function ConversationRow({ run, reach, send }: { run: SurfaceRun; reach: Reach; send: Send }) {
  const { t } = useTranslation('panel');
  const title = run.title.trim() || t('runs.untitled');
  const target = runTarget(run, reach);
  const open = targetMessage(run, target);
  const control = runControl(run, reach);
  return (
    <div className="pp-run-row">
      <button
        type="button"
        className="pp-run-open"
        disabled={!open}
        aria-label={
          target?.kind === 'app' ? t('runs.openInAtd', { title }) : t('runs.showTab', { title })
        }
        onClick={() => {
          if (open) send(open, { close: true });
        }}
      >
        <span className="pp-run-tile" aria-hidden="true">
          {initialOf(title)}
        </span>
        <span className="pp-lines">
          <span className="pp-run-title">{title}</span>
          <span className="pp-run-phase">
            {runNeedsPerson(run) ? (
              <span className="pp-attn" aria-hidden="true">
                ●
              </span>
            ) : null}
            {phaseOf(run, t)}
          </span>
        </span>
      </button>
      {control === 'stop' ? (
        <button
          type="button"
          className="btn-bordered pp-row-btn"
          aria-label={t('runs.stopLabel', { title })}
          onClick={() => send({ type: 'run.stop', taskId: run.taskId, runId: run.runId })}
        >
          <Square aria-hidden="true" fill="currentColor" />
          {t('runs.stop')}
        </button>
      ) : null}
      {control === 'reconnect' ? (
        <button
          type="button"
          className="btn-bordered pp-row-btn"
          aria-busy={reach === 'connecting'}
          aria-disabled={reach === 'connecting'}
          onClick={() => {
            if (reach !== 'connecting') send({ type: 'reconnect' });
          }}
        >
          {reach === 'connecting' ? (
            <span className="activity-indicator" aria-hidden="true" />
          ) : null}
          {t('runs.reconnect')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One turn under its conversation's row. In a conversation of several turns, each starts with the
 * person's request for it (`prompt`); a single turn's request is the row's title already. Then
 * Atd's reply, with `actions` beside Copy, or, for an earlier turn that ended without one, how it
 * ended (the row tells the latest turn's).
 */
function Turn({
  turn,
  thread,
  latest,
  actions,
}: {
  turn: SurfaceRun;
  thread: boolean;
  latest: boolean;
  actions: ReactNode;
}) {
  const { t } = useTranslation('panel');
  const prompt = thread ? turn.prompt?.trim() : undefined;
  const reply = runReply(turn);
  return (
    <>
      {prompt ? (
        <p className="pp-turn-prompt">
          <span className="sr-only">{t('runs.you')}</span>
          {prompt}
        </p>
      ) : null}
      {reply ? <RunReply reply={reply}>{actions}</RunReply> : null}
      {!latest && !reply ? <p className="pp-turn-note">{phaseOf(turn, t)}</p> : null}
    </>
  );
}

/**
 * A conversation: its row, then its turns oldest first. Once its latest turn has ended, Reply
 * (beside Copy, or on its own line when that turn has no reply) points the composer at it.
 */
function ConversationItem({
  conversation,
  reach,
  send,
  onReply,
}: {
  conversation: Conversation;
  reach: Reach;
  send: Send;
  onReply: OnReply;
}) {
  const { t } = useTranslation('panel');
  const { latest, turns } = conversation;
  const title = latest.title.trim() || t('runs.untitled');
  const reply = canReply(latest) ? (
    <button
      type="button"
      className="btn-plain pp-reply-action"
      aria-label={t('runs.replyLabel', { title })}
      onClick={() => onReply(latest.taskId)}
    >
      <Reply aria-hidden="true" />
      {t('runs.reply')}
    </button>
  ) : null;
  return (
    <li className="pp-run">
      <ConversationRow run={latest} reach={reach} send={send} />
      {turns.map((turn) => (
        <Turn
          key={turn.runId}
          turn={turn}
          thread={turns.length > 1}
          latest={turn === latest}
          actions={turn === latest ? reply : null}
        />
      ))}
      {reply && !runReply(latest) ? <div className="pp-turn-actions">{reply}</div> : null}
    </li>
  );
}

/**
 * Conversations tied to this Chrome, recently finished ones included, as a Mac sidebar's list: a
 * section title, then plain rows on the panel's background that highlight as one when pointed at
 * or pressed, each with its turns under it. The group exists only while there is a run to show:
 * an empty "Running" group would read as something being wrong.
 */
export function RunsGroup({
  conversations,
  reach,
  send,
  onReply,
}: {
  conversations: Conversation[];
  reach: Reach;
  send: Send;
  onReply: OnReply;
}) {
  const { t } = useTranslation('panel');
  const titleId = useId();
  if (conversations.length === 0) return null;
  return (
    <section className="pp-section" aria-labelledby={titleId}>
      <h2 className="pp-section-title" id={titleId}>
        {conversations.some(({ latest }) => isActiveRun(latest))
          ? t('runs.running')
          : t('runs.recent')}
      </h2>
      <ul className="pp-runs">
        {conversations.map((conversation) => (
          <ConversationItem
            key={conversation.taskId}
            conversation={conversation}
            reach={reach}
            send={send}
            onReply={onReply}
          />
        ))}
      </ul>
    </section>
  );
}
