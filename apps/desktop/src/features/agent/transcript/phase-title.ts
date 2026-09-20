import type { useTranslation } from 'react-i18next';
import type { ViewBlock } from './adapter';
import { isThinkingView, isToolView, toolCategory, type ActivityPhase } from './phases';

type T = ReturnType<typeof useTranslation<'tasks'>>['t'];

type PhaseTally = {
  reads: Set<string>;
  edits: Set<string>;
  searches: number;
  runs: number;
  agents: number;
  others: number;
};

function tallySteps(steps: ViewBlock[]): PhaseTally {
  const tally: PhaseTally = {
    reads: new Set(),
    edits: new Set(),
    searches: 0,
    runs: 0,
    agents: 0,
    others: 0,
  };
  for (const block of steps) {
    if (!isToolView(block)) continue;
    const kind = block.tool?.kind;
    const target = block.tool?.path ?? block.tool?.fileName ?? block.id;
    if (kind === 'write') tally.edits.add(target);
    else if (kind === 'search') tally.searches += 1;
    else if (kind === 'read') tally.reads.add(target);
    else if (kind === 'shell') tally.runs += 1;
    else if (kind === 'agent') tally.agents += 1;
    else tally.others += 1;
  }
  return tally;
}

function fileParam(paths: Set<string>, t: T): string {
  const [first] = paths;
  if (paths.size === 1 && first) return first.split('/').pop() || first;
  return t('transcript.verb.filesMany', { count: paths.size });
}

/**
 * The header while a phase is still running: only the latest step, not the whole tally — a
 * running tool reads as its own verb line, a question as its title, thinking as its state. Once
 * the phase settles the header falls back to `phaseTitle` below.
 */
export function latestStepTitle(step: ViewBlock, t: T): string {
  if (step.role === 'question') {
    return step.text.trim() || t('transcript.verb.toolOneLive');
  }
  if (step.role === 'reasoning') {
    return t(step.streaming ? 'transcript.verb.thinkLive' : 'transcript.verb.thinkDone');
  }
  return phaseTitle({ id: step.id, kind: toolCategory(step), steps: [step] }, true, t);
}

/**
 * The group's header: what the calls add up to — the latest step in the present tense while
 * the group is still running, so "Reading notes.txt" becomes "Ran 2 tools" the moment it
 * folds. A group that
 * also thought leads with its reasoning count ("Thought 7 times · Ran 10 tools"); a group of
 * pure thought is just the count. Ported from monocode `activityPhaseTitle` onto the frozen
 * `transcript.verb.*` keys; every key below is a literal so type checking catches typos.
 */
export function phaseTitle(phase: ActivityPhase, live: boolean, t: T): string {
  const thinkCount = phase.steps.filter(isThinkingView).length;
  const title = workTitle(phase, live, t);
  if (thinkCount <= 0) return title;
  const think =
    thinkCount === 1
      ? t('transcript.verb.thinkCountOne')
      : t('transcript.verb.thinkCountMany', { count: thinkCount });
  if (phase.kind === 'think') return think;
  return `${think} · ${title}`;
}

function settledToolTitle(steps: ViewBlock[], t: T): string {
  const count = steps.filter(isToolView).length;
  if (count <= 0) return t('transcript.verb.working');
  if (count === 1) return t('transcript.verb.toolOneDone');
  return t('transcript.verb.toolManyDone', { count });
}

function workTitle(phase: ActivityPhase, live: boolean, t: T): string {
  if (!live && (phase.kind === 'research' || phase.kind === 'edit' || phase.kind === 'run')) {
    return settledToolTitle(phase.steps, t);
  }
  const tally = tallySteps(phase.steps);
  switch (phase.kind) {
    case 'edit':
      if (tally.edits.size === 0) return t('transcript.verb.editLiveShort');
      return t('transcript.verb.editLive', {
        file: fileParam(tally.edits, t),
      });
    case 'research':
      if (tally.reads.size > 0 && tally.searches === 0)
        return t('transcript.verb.readLive', {
          file: fileParam(tally.reads, t),
        });
      if (tally.reads.size === 0 && tally.searches > 0) return t('transcript.verb.searchLive');
      if (tally.reads.size === 0 && tally.searches === 0)
        return t('transcript.verb.exploreLiveShort');
      return t('transcript.verb.exploreLive');
    case 'run':
      if (tally.runs === 1) return t('transcript.verb.runOneLive');
      if (tally.runs > 1)
        return t('transcript.verb.runManyLive', {
          count: tally.runs,
        });
      return t('transcript.verb.working');
    case 'agent': {
      const count = phase.steps.filter(isToolView).length;
      if (count <= 1)
        return t(live ? 'transcript.verb.agentOneLive' : 'transcript.verb.agentOneDone');
      return t(live ? 'transcript.verb.agentManyLive' : 'transcript.verb.agentManyDone', { count });
    }
    case 'think':
      return t(live ? 'transcript.verb.thinkLive' : 'transcript.verb.thinkDone');
    case 'other': {
      const count = phase.steps.filter(isToolView).length;
      if (count <= 0) return t('transcript.verb.working');
      if (count === 1)
        return t(live ? 'transcript.verb.toolOneLive' : 'transcript.verb.toolOneDone');
      return t(live ? 'transcript.verb.toolManyLive' : 'transcript.verb.toolManyDone', { count });
    }
    default: {
      const _exhaustive: never = phase.kind;
      void _exhaustive;
      return t('transcript.verb.working');
    }
  }
}

/** Expand/collapse affordance for a phase header, with the step count it will reveal or hide. */
export function phaseToggleLabel(open: boolean, count: number, t: T): string {
  if (open) {
    return count === 1 ? t('transcript.phase.hideOne') : t('transcript.phase.hide', { count });
  }
  return count === 1 ? t('transcript.phase.showOne') : t('transcript.phase.show', { count });
}
