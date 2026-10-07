import { Type, type Static } from 'typebox';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import {
  AUTOMATION_TOOL,
  AutomationDraftSchema,
  AutomationTriggerSchema,
  Identifier,
  parse,
  type Automation,
  type AutomationDraft,
  type FolderRef,
} from '@atd/agent-contracts';
import type { HarnessDeps } from '../harness/deps.js';
import type { Gate } from '../harness/gate.js';
import { isUnattendedRun } from '../unattended.js';
import { checkDraft } from './checks.js';
import { automationDetail } from './describe.js';
import {
  createAutomation,
  deleteAutomation,
  setAutomationEnabled,
  updateAutomation,
} from './edits.js';
import { processTimeZone, wallClock } from './schedule.js';
import { AutomationService } from './service.js';

/**
 * The `automation` tool (decision D10): the agent lists, reads, previews, saves, deletes, switches
 * and runs the person's automations through the same edits the routes make, and reads the clock,
 * time zone and attached folders a new trigger is written against. Every change and every run
 * waits for the person's confirmation (`askAlways`: a saved automation acts later with nobody
 * present), described in plain words, and a run an automation started can only read.
 */

const Revision = Type.Integer({ minimum: 1 });

/** The validated call: one variant per operation. */
const AutomationCallSchema = Type.Union([
  Type.Object({ op: Type.Literal('list') }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal('context') }, { additionalProperties: false }),
  Type.Object(
    { op: Type.Literal('get'), automationId: Identifier },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal('preview'),
      trigger: AutomationTriggerSchema,
      automationId: Type.Optional(Identifier),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { op: Type.Literal('create'), automation: AutomationDraftSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal('update'),
      automationId: Identifier,
      expectedRevision: Revision,
      automation: AutomationDraftSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Union([
        Type.Literal('delete'),
        Type.Literal('enable'),
        Type.Literal('disable'),
        Type.Literal('run'),
      ]),
      automationId: Identifier,
    },
    { additionalProperties: false },
  ),
]);
type AutomationCall = Static<typeof AutomationCallSchema>;

/** What the model sees; providers need an object root, so the union above is flattened here. */
export const AutomationToolParametersSchema = Type.Object(
  {
    op: Type.Union(
      [
        'list',
        'get',
        'context',
        'preview',
        'create',
        'update',
        'delete',
        'enable',
        'disable',
        'run',
      ].map((op) => Type.Literal(op)),
      {
        description:
          "list: every automation with its state. get: one automation with its status. context: the current time, the time zone of the person's Mac and the folders attached to this conversation. preview: the next run times of a trigger, or why it cannot fire. create, update: save an automation. delete, enable, disable, run: act on one; run starts it now.",
      },
    ),
    automationId: Type.Optional(
      Type.String({ description: 'get, update, delete, enable, disable, run: which automation.' }),
    ),
    expectedRevision: Type.Optional(
      Type.Integer({ minimum: 1, description: 'update: the revision get or list reported.' }),
    ),
    automation: Type.Optional({
      ...AutomationDraftSchema,
      description:
        "create, update: the whole automation. Schedule times are wall-clock times in the trigger time zone (an IANA id; context answers the Mac's); one-time runs are ISO date-times with an offset; intervals and custom cron fire at most every 15 minutes. An idle trigger fires at most once a day, the first time the Mac has had no input for idleMinutes (5 to 120) while none of the person's tasks is running; its time zone bounds the day. A folder trigger and policy.folderIds name folders by the ids context lists. permissionTier decides what the unattended runs may do: actions it would ask about are declined. The consolidateMemory action starts no task: the memory engine merges duplicate memories and rewrites outdated ones, and only suggests removals; it uses policy.model, thinkingLevel and maxDurationMinutes and ignores the tier, tools, memory switch and folders.",
    }),
    trigger: Type.Optional({ ...AutomationTriggerSchema, description: 'preview: the trigger.' }),
  },
  { additionalProperties: false },
);

const DESCRIPTION =
  "Manage the person's automations: saved work that starts by itself on a schedule, when files arrive in a folder attached to this conversation, once a day when the Mac is idle, or after another automation, and either runs a prompt or command as a new task with nobody present or consolidates memory. Read context for the time, time zone and folders a trigger is written against, and preview a trigger before saving it. Saving, deleting, switching and running ask the person to confirm. A run that an automation started cannot change or run automations. To update, get the automation first and pass its revision.";

interface ToolContext {
  dataDir: string;
  gate: Gate;
  /** Whether the calling run was started by an automation. */
  unattended: () => boolean;
  /**
   * The folders attached to the conversation, as its current run may read them. They are the only
   * folders `context` offers for a trigger or readable folders, so the agent never names a path.
   */
  folders: () => readonly Pick<FolderRef, 'id' | 'name'>[];
}

function summary(automation: Automation) {
  const { id, revision, name, enabled, trigger } = automation;
  return { id, revision, name, enabled, trigger: trigger.kind };
}

type ReadCall = Extract<AutomationCall, { op: 'list' | 'context' | 'get' | 'preview' }>;
type WriteCall = Exclude<AutomationCall, ReadCall>;

/** Runs one call; answers the model-facing text. */
export async function runAutomationCall(
  ctx: ToolContext,
  args: unknown,
  toolCallId: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const call: AutomationCall = parse(AutomationCallSchema, args);
  const service = AutomationService.for(ctx.dataDir);
  if (call.op === 'list' || call.op === 'context' || call.op === 'get' || call.op === 'preview')
    return read(ctx, service, call);
  if (ctx.unattended())
    throw new Error(
      'An automation started this run, so it cannot change or run automations. Use list, get, context or preview, and say in your answer what should change.',
    );
  const approve = async (title: string, draft: AutomationDraft | Automation, note = '') => {
    const check = service.checkContext();
    const commandId = draft.action.kind === 'command' ? draft.action.commandId : null;
    const command = commandId ? await check.lookups.command(commandId) : null;
    const detail = `${note}${automationDetail(draft, check, command?.name ?? null)}`;
    await ctx.gate({
      toolCallId,
      scope: { tool: 'automation' },
      title,
      detail,
      signal,
      askAlways: true,
    });
  };
  return write(service, call, approve);
}

/**
 * The clock and zone a schedule is written against, the weekday included for relative dates, with
 * the folders a trigger may name. The zone is the service process's, the editor's default too.
 */
function authoringContext(now: number, folders: readonly Pick<FolderRef, 'id' | 'name'>[]) {
  const timezone = processTimeZone();
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' });
  return { now: `${weekday.format(now)} ${wallClock(now, timezone)}`, timezone, folders };
}

async function read(ctx: ToolContext, service: AutomationService, call: ReadCall): Promise<string> {
  switch (call.op) {
    case 'list': {
      const { automations, paused, problem } = await service.list();
      if (!automations.length && !problem) return 'The person has no automations yet.';
      return JSON.stringify({
        paused,
        ...(problem ? { problem } : {}),
        automations: automations.map((item) => ({ ...summary(item.automation), ...item.status })),
      });
    }
    case 'context':
      return JSON.stringify(authoringContext(service.checkContext().now, ctx.folders()));
    case 'get':
      return JSON.stringify(await service.item(call.automationId));
    case 'preview':
      return JSON.stringify(service.preview({ ...call, count: 3 }));
  }
}

type Approve = (title: string, draft: AutomationDraft | Automation, note?: string) => Promise<void>;

/** Validates, asks the person, then applies; whatever would be refused is refused before asking. */
async function write(service: AutomationService, call: WriteCall, approve: Approve) {
  const edits = service.edits();
  switch (call.op) {
    case 'create': {
      await checkDraft(call.automation, service.checkContext(), undefined);
      await approve(`Create the automation "${call.automation.name}"?`, call.automation);
      return JSON.stringify(summary(await createAutomation(edits, call.automation, 'agent')));
    }
    case 'update': {
      const current = service.automation(call.automationId);
      if (current.revision !== call.expectedRevision)
        throw new Error('This automation changed. Get it again, then apply your change.');
      await checkDraft(call.automation, service.checkContext(), current.id);
      await approve(`Change the automation "${current.name}"?`, call.automation);
      const request = { expectedRevision: call.expectedRevision, automation: call.automation };
      return JSON.stringify(summary(await updateAutomation(edits, current.id, request)));
    }
    case 'delete': {
      const current = service.automation(call.automationId);
      const note = 'Deletes the automation and its run history.\n\n';
      await approve(`Delete the automation "${current.name}"?`, current, note);
      await deleteAutomation(edits, current.id, (taskId, runId) => service.cancel(taskId, runId));
      return JSON.stringify({ deleted: current.id });
    }
    case 'enable':
    case 'disable': {
      const current = service.automation(call.automationId);
      const enabled = call.op === 'enable';
      if (enabled) await checkDraft(current, service.checkContext(), current.id);
      const verb = enabled ? 'Turn on' : 'Turn off';
      await approve(`${verb} the automation "${current.name}"?`, { ...current, enabled });
      const request = { enabled, expectedRevision: current.revision };
      return JSON.stringify(summary(await setAutomationEnabled(edits, current.id, request)));
    }
    case 'run': {
      const current = service.automation(call.automationId);
      if (service.engine.running(current.id)) throw new Error('The automation is already running.');
      const note =
        current.action.kind === 'consolidateMemory'
          ? 'Consolidates memory now.\n\n'
          : 'Runs it now, as a new task with nobody present.\n\n';
      await approve(`Run the automation "${current.name}" now?`, current, note);
      const run = await service.engine.runNow(current.id);
      return JSON.stringify({ runId: run.id, outcome: run.outcome });
    }
  }
}

/** The parent session's `automation` tool. */
export function automationExtension(deps: HarnessDeps): ExtensionFactory {
  const { runner } = deps;
  const ctx: ToolContext = {
    dataDir: runner.ctx.paths.root,
    gate: deps.gate,
    unattended: () => isUnattendedRun(runner.ctx.ledger, runner.taskId, runner.currentRunId()),
    folders: () => runner.currentMaterial().folders.map(({ id, name }) => ({ id, name })),
  };
  return (pi) => {
    pi.registerTool({
      name: AUTOMATION_TOOL,
      label: 'Automations',
      description: DESCRIPTION,
      parameters: AutomationToolParametersSchema,
      executionMode: 'sequential',
      async execute(toolCallId, params, signal) {
        signal?.throwIfAborted();
        const text = await runAutomationCall(ctx, params, toolCallId, signal ?? undefined);
        return { content: [{ type: 'text', text }], details: {} };
      },
    });
  };
}
