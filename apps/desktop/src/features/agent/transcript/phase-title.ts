import type { useTranslation } from 'react-i18next';
import { isThinkingView, isToolView, type ActivityPhase } from './phases';

type T = ReturnType<typeof useTranslation<'tasks'>>['t'];

/**
 * The group's header, live and settled alike: what the calls add up to so far. A group that
 * also thought leads with its reasoning count ("Thought 7 times · Ran 10 tools"), and subagents
 * the group launched close it ("· Invoked 2 subagents"); a call that launched them counts there,
 * not as a tool. A group of pure thought is just the count. While the group runs the same tally grows under a shimmer,
 * so the header never flips between the latest step and the total. Only a group with nothing
 * to count yet reads by its state. Every key below is a literal so type checking catches typos.
 */
export function phaseTitle(phase: ActivityPhase, live: boolean, t: T): string {
  const thinkCount = phase.steps.filter(isThinkingView).length;
  const tools = phase.steps.filter(isToolView);
  const launched = tools.reduce((sum, step) => sum + (step.tool?.subagents ?? 0), 0);
  const toolCount = tools.filter((step) => !step.tool?.subagents).length;
  const parts: string[] = [];
  if (thinkCount === 1) parts.push(t('transcript.verb.thinkCountOne'));
  else if (thinkCount > 1) parts.push(t('transcript.verb.thinkCountMany', { count: thinkCount }));
  if (toolCount === 1) parts.push(t('transcript.verb.toolOneDone'));
  else if (toolCount > 1) parts.push(t('transcript.verb.toolManyDone', { count: toolCount }));
  if (launched === 1) parts.push(t('transcript.verb.agentOneDone'));
  else if (launched > 1) parts.push(t('transcript.verb.agentManyDone', { count: launched }));
  if (parts.length > 0) return parts.join(' · ');
  if (phase.kind !== 'think') return t('transcript.verb.working');
  return t(live ? 'transcript.verb.thinkLive' : 'transcript.verb.thinkDone');
}

/** Expand/collapse affordance for a phase header, with the step count it will reveal or hide. */
export function phaseToggleLabel(open: boolean, count: number, t: T): string {
  if (open) {
    return count === 1 ? t('transcript.phase.hideOne') : t('transcript.phase.hide', { count });
  }
  return count === 1 ? t('transcript.phase.showOne') : t('transcript.phase.show', { count });
}
