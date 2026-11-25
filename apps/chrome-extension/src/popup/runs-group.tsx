import { Square } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { RunView } from '../channel/payloads.ts';
import type { PopupMessage } from '../messages/popup.ts';
import {
  isActiveRun,
  runControl,
  runNeedsPerson,
  runTarget,
  type Reach,
  type RunTarget,
} from './model.ts';

type Send = (message: PopupMessage, options?: { close: boolean }) => void;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The tile's letter: the title's first character, as Atd's task list draws it. */
function initialOf(title: string): string {
  const first = graphemes.segment(title).containing(0)?.segment ?? '';
  return first.toLocaleUpperCase();
}

/** What a run is doing right now, in one line under its title. */
function phaseOf(run: RunView, t: TFunction<'popup'>): string {
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

function targetMessage(run: RunView, target: RunTarget): PopupMessage | null {
  if (!target) return null;
  return target.kind === 'tab'
    ? { type: 'tab.show', tabId: target.tabId }
    : { type: 'app.open', taskId: run.taskId };
}

function RunRow({ run, reach, send }: { run: RunView; reach: Reach; send: Send }) {
  const { t } = useTranslation('popup');
  const title = run.title.trim() || t('runs.untitled');
  const target = runTarget(run, reach);
  const open = targetMessage(run, target);
  const control = runControl(run, reach);
  return (
    <li>
      <div className="list__row pp-run">
        <button
          type="button"
          className="pp-task"
          disabled={!open}
          aria-label={
            target?.kind === 'app' ? t('runs.openInAtd', { title }) : t('runs.showTab', { title })
          }
          onClick={() => {
            if (open) send(open, { close: true });
          }}
        >
          <span className="list__icon pp-icon-task" aria-hidden="true">
            {initialOf(title)}
          </span>
          <span className="pp-lines">
            <span className="list__label">{title}</span>
            <span className="list__subtitle">
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
    </li>
  );
}

/**
 * Runs tied to this Chrome, recently finished ones included. The group exists only while there
 * is a run to show: an empty "Running" group would read as something being wrong.
 */
export function RunsGroup({ runs, reach, send }: { runs: RunView[]; reach: Reach; send: Send }) {
  const { t } = useTranslation('popup');
  if (runs.length === 0) return null;
  return (
    <>
      <h2 className="list-header">
        {runs.some(isActiveRun) ? t('runs.running') : t('runs.recent')}
      </h2>
      <ul className="list">
        {runs.map((run) => (
          <RunRow key={`${run.taskId}:${run.runId}`} run={run} reach={reach} send={send} />
        ))}
      </ul>
    </>
  );
}
