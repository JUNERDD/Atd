import { randomUUID } from 'node:crypto';
import {
  MAX_AUTOMATION_NOTICES,
  type Automation,
  type AutomationNotice,
  type AutomationNoticeKind,
  type AutomationNotify,
  type AutomationOutcome,
  type AutomationRun,
  type AutomationRunReason,
  type RunStatus,
  type ServiceBlock,
} from '@atd/agent-contracts';
import { clip, FAILED_PREFIX, NOTHING_NEW } from './prompt.js';

/**
 * How a finished task run becomes an automation result (decision D4) and which notice it posts
 * (decision D5). Unattended declines are counted from the run's audit lines (`decision:
 * 'unattended'`, decision D1), so a run that declined anything needs attention whatever it answered.
 */

const SUMMARY_CHARS = 500;
const DETAIL_CHARS = 2000;
/** Notices the shell has not posted within this long are dropped. */
export const NOTICE_TTL_MS = 60 * 60_000;

/** How a task run ended, as its supervisor observed it. */
export interface RunEnd {
  status: RunStatus;
  error: string;
  /** The run's final answer: its last assistant text. */
  answer: string;
  /** Guarded actions declined and questions left unanswered because nobody was present. */
  declined: number;
  /** Files its write and edit tools changed, absolute and NFC (unattended.ts `wrote` lines). */
  wrote: readonly string[];
  /** The supervisor stopped it for running past its maximum duration. */
  timedOut: boolean;
}

export interface Classified {
  outcome: AutomationOutcome;
  reason?: AutomationRunReason;
  detail?: string;
  summary?: string;
}

function summary(answer: string): { summary?: string } {
  const text = clip(answer, SUMMARY_CHARS);
  return text ? { summary: text } : {};
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  );
}

/** The result of a run that ended as `end`; `notify` decides whether `NOTHING_NEW` was asked for. */
export function classify(end: RunEnd, notify: AutomationNotify): Classified {
  switch (end.status) {
    case 'completed': {
      if (end.declined > 0) return { outcome: 'needsAttention', ...summary(end.answer) };
      if (notify === 'whenNew' && firstLine(end.answer) === NOTHING_NEW)
        return { outcome: 'nothingNew' };
      const answer = end.answer.trim();
      if (answer.startsWith(FAILED_PREFIX)) {
        const why = clip(answer.slice(FAILED_PREFIX.length), DETAIL_CHARS);
        return {
          outcome: 'failed',
          reason: 'agentReported',
          ...(why ? { detail: why, summary: clip(why, SUMMARY_CHARS) } : {}),
        };
      }
      return { outcome: 'delivered', ...summary(end.answer) };
    }
    case 'failed':
      return {
        outcome: 'failed',
        reason: 'runFailed',
        detail: clip(end.error || 'The run failed.', DETAIL_CHARS),
      };
    case 'stopped':
    case 'cancelled':
      return { outcome: end.timedOut ? 'timedOut' : 'stopped' };
    case 'interrupted':
    case 'unknown':
    case 'queued':
    case 'running':
    case 'awaiting_input':
    case 'awaiting_confirmation':
    case 'stopping':
      return { outcome: 'interrupted' };
  }
}

/** Whether a finished outcome counts toward the auto-pause (decision D7). */
export function isFailure(outcome: AutomationOutcome): boolean {
  return outcome === 'failed' || outcome === 'timedOut';
}

/** The notice a finished run posts, if any (decision D5). */
export function noticeKind(
  outcome: AutomationOutcome,
  notify: AutomationNotify,
): AutomationNoticeKind | null {
  switch (outcome) {
    case 'delivered':
      return notify === 'never' ? null : 'delivered';
    case 'needsAttention':
      return 'needsAttention';
    case 'failed':
    case 'timedOut':
      return 'failed';
    case 'running':
    case 'nothingNew':
    case 'stopped':
    case 'interrupted':
    case 'skipped':
      return null;
  }
}

export function makeNotice(
  automation: Automation,
  kind: AutomationNoticeKind,
  run: AutomationRun | undefined,
  now: number,
): AutomationNotice {
  const text = run?.summary ?? run?.detail;
  return {
    id: randomUUID(),
    kind,
    automationId: automation.id,
    automationName: automation.name,
    ...(run?.taskId ? { taskId: run.taskId } : {}),
    ...(text ? { summary: clip(text, SUMMARY_CHARS) } : {}),
    ...(kind === 'needsAttention' ? { declined: run?.declined ?? 0 } : {}),
    createdAt: new Date(now).toISOString(),
  };
}

/** The notices still worth posting at `now`: younger than an hour, at most the newest 50. */
export function liveNotices(notices: readonly AutomationNotice[], now: number): AutomationNotice[] {
  return notices
    .filter((notice) => now - Date.parse(notice.createdAt) < NOTICE_TTL_MS)
    .slice(-MAX_AUTOMATION_NOTICES);
}

/** The run's final answer: the last non-empty assistant text among the task's blocks of `runId`. */
export function finalAnswer(blocks: readonly ServiceBlock[], runId: string): string {
  let answer = '';
  for (const block of blocks)
    if (block.kind === 'assistant' && block.runId === runId && block.text.trim())
      answer = block.text;
  return answer;
}
