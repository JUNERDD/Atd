import type {
  Automation,
  AutomationDraft,
  AutomationTrigger,
  PermissionTier,
} from '@atd/agent-contracts';
import type { CheckContext } from './checks.js';
import { onceTime, upcoming, wallClock } from './schedule.js';

/**
 * What the person approves when the agent saves, changes or runs an automation (decision D10):
 * the trigger in words with its next run times in the trigger's own time zone, the action, the
 * approval tier and tools its unattended runs get, and how it notifies. English, like every
 * confirm detail the service writes; the confirm title is localized by the renderer.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const TIERS: Record<PermissionTier, string> = {
  manual: 'manual: nobody is present to approve, so every action that needs approval is declined.',
  auto: 'auto: a model review allows routine actions; whatever it would ask about is declined.',
  always: 'always allow: file writes, the shell and other guarded actions run without asking.',
};

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function every(minutes: number): string {
  if (minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

function folderName(ctx: CheckContext, id: string): string {
  try {
    return ctx.folders.resolve([id])[0]?.name ?? id;
  } catch {
    return `${id} (not registered)`;
  }
}

/** The trigger in words. */
export function describeTrigger(trigger: AutomationTrigger, ctx: CheckContext): string {
  switch (trigger.kind) {
    case 'schedule': {
      const { schedule, timezone } = trigger;
      const zone = ` (${timezone})`;
      switch (schedule.kind) {
        case 'once': {
          const at = onceTime(schedule.at);
          return `Once, at ${at === null ? schedule.at : wallClock(at, timezone)}${zone}`;
        }
        case 'interval':
          return `Every ${every(schedule.everyMinutes)}, counted from the last run`;
        case 'daily':
          return `Every day at ${schedule.time}${zone}`;
        case 'weekly': {
          const days = [...schedule.days].sort((a, b) => a - b).map((day) => WEEKDAYS[day]);
          return `Every ${days.join(', ')} at ${schedule.time}${zone}`;
        }
        case 'monthly':
          return schedule.day === 'last'
            ? `On the last day of every month at ${schedule.time}${zone}`
            : `On day ${schedule.day} of every month at ${schedule.time}${zone}`;
        case 'cron':
          return `On the cron schedule "${schedule.expression}"${zone}`;
      }
      break;
    }
    case 'folder': {
      const events = trigger.events.join(' or ');
      const patterns = trigger.patterns.length ? `, matching ${trigger.patterns.join(', ')}` : '';
      const deep = trigger.recursive ? ', subfolders included' : '';
      return `When files are ${events} in the folder "${folderName(ctx, trigger.folderId)}"${patterns}${deep}`;
    }
    case 'idle':
      return `Once a day when the Mac has been idle ${plural(trigger.idleMinutes, 'minute')} and no task of the person's is running (days counted in ${trigger.timezone})`;
    case 'automation': {
      const upstream = ctx.automations.find((item) => item.id === trigger.automationId);
      return `After the automation "${upstream?.name ?? trigger.automationId}" ends as ${trigger.outcomes.join(' or ')}`;
    }
  }
}

function nextRuns(trigger: AutomationTrigger, ctx: CheckContext): string | null {
  if (trigger.kind !== 'schedule') return null;
  try {
    const runs = upcoming(trigger, ctx.now, 3).map((run) =>
      wallClock(Date.parse(run), trigger.timezone),
    );
    return runs.length ? `Next runs: ${runs.join('; ')} (${trigger.timezone})` : 'No run is left.';
  } catch {
    return null;
  }
}

const CONSOLIDATION =
  'Consolidate memory: merges duplicate memories and rewrites outdated ones, keeping their history; removals are only suggested, for the person to confirm. Nothing is written while memory learning is paused.';

function action(draft: AutomationDraft, commandName: string | null): string {
  if (draft.action.kind === 'consolidateMemory') return CONSOLIDATION;
  if (draft.action.kind === 'prompt') return `Prompt:\n${draft.action.prompt}`;
  const { input, arguments: values } = draft.action;
  const parts = [`Command: "${commandName ?? draft.action.commandId}"`];
  if (input.trim()) parts.push(`Input: ${input}`);
  if (Object.keys(values).length) parts.push(`Arguments: ${JSON.stringify(values)}`);
  return parts.join('\n');
}

function notify(draft: AutomationDraft): string {
  switch (draft.delivery.notify) {
    case 'whenNew':
      return 'Notifies when there is something new; failed runs and runs that need attention always notify.';
    case 'always':
      return 'Notifies after every run.';
    case 'never':
      return 'Notifies only when a run fails or needs attention.';
  }
}

function modelText(draft: AutomationDraft): string {
  const { model } = draft.policy;
  if (model) return `${model.modelId} (${model.connectionId})`;
  return draft.action.kind === 'command'
    ? "the command's own model, else the default model when it runs"
    : 'the default model when it runs';
}

/**
 * The confirm detail of a memory consolidation: it starts no task, so the tier, tools, folders
 * and memory switch of its policy do not apply, and it has no previous answer to read.
 */
function consolidationDetail(draft: AutomationDraft | Automation, ctx: CheckContext): string {
  const lines = [
    `Name: ${draft.name}`,
    `When: ${describeTrigger(draft.trigger, ctx)}`,
    nextRuns(draft.trigger, ctx),
    action(draft, null),
    `Model: ${modelText(draft)}`,
    `Stops after ${plural(draft.policy.maxDurationMinutes, 'minute')}.`,
    notify(draft),
    `Enabled: ${draft.enabled ? 'yes' : 'no'}`,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/** The confirm detail of a saved or changed automation. */
export function automationDetail(
  draft: AutomationDraft | Automation,
  ctx: CheckContext,
  commandName: string | null,
): string {
  if (draft.action.kind === 'consolidateMemory') return consolidationDetail(draft, ctx);
  const { policy } = draft;
  const tools =
    draft.action.kind === 'command'
      ? "the command's own tools"
      : (policy.tools ?? ['read', 'write', 'edit', 'grep', 'find', 'ls']).join(', ');
  const folders = policy.folderIds.map((id) => folderName(ctx, id));
  const lines = [
    `Name: ${draft.name}`,
    `When: ${describeTrigger(draft.trigger, ctx)}`,
    nextRuns(draft.trigger, ctx),
    action(draft, commandName),
    `Approval tier: ${TIERS[policy.permissionTier]}`,
    `Tools: ${tools}`,
    `Model: ${modelText(draft)}`,
    `Every run can also search the web and fetch pages, use the person's apps, delegate to subagents and call connected MCP servers, under the same approval tier.`,
    `Memory: ${policy.memory ? 'searched and read, never changed' : 'not used'}; automation runs never teach memory.`,
    folders.length ? `Readable folders: ${folders.join(', ')}` : null,
    `Stops after ${plural(policy.maxDurationMinutes, 'minute')}.`,
    draft.trigger.kind === 'idle'
      ? null
      : `Missed runs: ${policy.missedRuns === 'runOnce' ? 'the latest runs once, late' : 'skipped'}.`,
    notify(draft),
    draft.delivery.includePreviousResult ? 'Each run sees the previous answer.' : null,
    `Enabled: ${draft.enabled ? 'yes' : 'no'}`,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}
