import type { AutomationDraft, NextStep } from '@atd/agent-contracts';
import { defaultSchedule, newDraft } from '../../automations/automation-draft';
import { systemTimeZone } from '../../automations/automation-time';

/** A weekly schedule as the dialog edits it: cron weekdays (0 is Sunday) and a time of day. */
export interface WeeklyTimes {
  days: number[];
  time: string;
}

/** The schedule the dialog starts with: the suggestion's proposal, else the editor's weekly one. */
export function proposedSchedule(step: NextStep): WeeklyTimes {
  if (step.schedule) return { days: [...step.schedule.days], time: step.schedule.time };
  const schedule = defaultSchedule('weekly', systemTimeZone());
  return schedule.kind === 'weekly'
    ? { days: schedule.days, time: schedule.time }
    : { days: [], time: '' };
}

/**
 * The automation a confirmed suggestion saves: a new automation as the editor starts one
 * (`newDraft`: on, the default prompt policy and delivery), running `prompt` on the weekly
 * schedule on the Mac's clock.
 */
export function suggestedAutomation(
  name: string,
  prompt: string,
  { days, time }: WeeklyTimes,
): AutomationDraft {
  return {
    ...newDraft(),
    name: name.trim(),
    trigger: {
      kind: 'schedule',
      schedule: { kind: 'weekly', days, time },
      timezone: systemTimeZone(),
    },
    action: { kind: 'prompt', prompt: prompt.trim() },
  };
}
