import { Square } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { RunView } from '../channel/payloads.ts';
import type { PanelMessage } from '../messages/panel.ts';
import type { SurfaceRun } from '../messages/views.ts';
import type { Reach } from '../pages/link.ts';
import {
  isActiveRun,
  runControl,
  runNeedsPerson,
  runReply,
  runTarget,
  type RunTarget,
} from './model.ts';
import { RunReply } from './run-reply.tsx';

type Send = (message: PanelMessage, options?: { close: boolean }) => void;

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

function RunRow({ run, reach, send }: { run: SurfaceRun; reach: Reach; send: Send }) {
  const { t } = useTranslation('panel');
  const title = run.title.trim() || t('runs.untitled');
  const target = runTarget(run, reach);
  const open = targetMessage(run, target);
  const control = runControl(run, reach);
  const reply = runReply(run);
  return (
    <li className="pp-run">
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
      {reply ? <RunReply reply={reply} /> : null}
    </li>
  );
}

/**
 * Runs tied to this Chrome, recently finished ones included, as a Mac sidebar's list: a section
 * title, then plain rows on the panel's background that highlight as one when pointed at or
 * pressed. The group exists only while there is a run to show: an empty "Running" group would
 * read as something being wrong.
 */
export function RunsGroup({ runs, reach, send }: { runs: SurfaceRun[]; reach: Reach; send: Send }) {
  const { t } = useTranslation('panel');
  const titleId = useId();
  if (runs.length === 0) return null;
  return (
    <section className="pp-section" aria-labelledby={titleId}>
      <h2 className="pp-section-title" id={titleId}>
        {runs.some(isActiveRun) ? t('runs.running') : t('runs.recent')}
      </h2>
      <ul className="pp-runs">
        {runs.map((run) => (
          <RunRow key={`${run.taskId}:${run.runId}`} run={run} reach={reach} send={send} />
        ))}
      </ul>
    </section>
  );
}
