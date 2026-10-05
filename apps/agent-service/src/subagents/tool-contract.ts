import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type TSchema } from 'typebox';
import { launchAgentName, TaskAgentRequestsSchema } from './task-agent-definition.js';

/**
 * The service-owned model contract of pi-subagents' `subagent` tool. Upstream advertises its whole
 * surface (async runs, guides, management actions…), most of which the service guard refuses, so
 * models kept calling shapes that could only fail. The service swaps in a description and a closed
 * schema that list exactly the calls the guard admits; pi-subagents still executes them (its
 * data-only `tasks` and `chain`, which it admits with workflow scripts disabled, config.ts), and
 * the guard stays the authority on what a call may do. The `define` action is the service's own:
 * pi-subagents never sees it (task-agents.ts handles it).
 */

export const SUBAGENT_TOOL = 'subagent';

/** Longest `setTimeout` delay Node.js honors; pi-subagents rejects a larger `timeoutMs`. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Longest task one child receives, in characters; the guard checks it on every child. */
export const SUBAGENT_TASK_MAX_LENGTH = 8000;

/**
 * Most children one launching call may run, counting every `tasks` child and every chain step's
 * children; the guard refuses a larger call.
 */
export const SUBAGENT_CHILDREN_PER_CALL = 8;

/** Actions a parent may call; everything else launches children or is refused. */
export const SUBAGENT_ACTIONS = ['define', 'list', 'status'] as const;

/** Keys each action may carry besides `action`. */
export const SUBAGENT_ACTION_KEYS: Readonly<
  Record<(typeof SUBAGENT_ACTIONS)[number], readonly string[]>
> = {
  define: ['agents'],
  list: ['capabilities'],
  status: ['id'],
};

/** One child of a `tasks` batch or of a chain's parallel step. */
const ChildTask = Type.Object(
  {
    agent: Type.String({ minLength: 1, description: 'The agent to run.' }),
    task: Type.String({ minLength: 1, description: 'The complete, self-contained task.' }),
  },
  { additionalProperties: false },
);

/**
 * Closed parameter schema: pi rejects any other key before the guard runs. `async` stays declared so
 * a habitual `async:false` validates; the guard refuses `async:true` with a readable reason.
 * Enums rather than literal unions keep a wrong value to one validation message. A chain step is
 * one flat object, `{ agent, task }` or `{ parallel }`, as pi-subagents declares it, because some
 * provider converters drop object-shape unions; the guard tells the two apart.
 */
export const SubagentToolParams = Type.Object(
  {
    agent: Type.Optional(Type.String({ description: 'One child: the agent to run.' })),
    task: Type.Optional(
      Type.String({
        description: `One child: the complete, self-contained task (1-${SUBAGENT_TASK_MAX_LENGTH} characters).`,
      }),
    ),
    tasks: Type.Optional(
      Type.Array(ChildTask, {
        minItems: 1,
        description: 'Several children at the same time; their results come back in order.',
      }),
    ),
    chain: Type.Optional(
      Type.Array(
        Type.Object(
          {
            agent: Type.Optional(Type.String({ minLength: 1 })),
            task: Type.Optional(Type.String({ minLength: 1 })),
            parallel: Type.Optional(Type.Array(ChildTask, { minItems: 1 })),
          },
          { additionalProperties: false },
        ),
        {
          minItems: 1,
          description:
            'Children in order: each step is { agent, task } or { parallel: [{ agent, task }, ...] } and receives the previous step’s output.',
        },
      ),
    ),
    async: Type.Optional(
      Type.Boolean({ description: 'Omit it or pass false: every call runs in the foreground.' }),
    ),
    timeoutMs: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_TIMER_DELAY_MS,
        description: 'Optional deadline for the launch.',
      }),
    ),
    action: Type.Optional(
      Type.Enum([...SUBAGENT_ACTIONS], {
        description: 'Instead of launching: define task agents, list agents, or report a run.',
      }),
    ),
    agents: Type.Optional(TaskAgentRequestsSchema),
    capabilities: Type.Optional(
      Type.Boolean({ description: 'list only: include each agent’s tools and model.' }),
    ),
    id: Type.Optional(Type.String({ minLength: 1, description: 'status: the run id to report.' })),
  },
  { additionalProperties: false },
);

/**
 * True for a call that launches children rather than an action. A null action counts as omitted,
 * as in `prepareSubagentArguments`, because transcripts keep the model's raw arguments.
 */
export function isSubagentLaunch(args: Record<string, unknown>): boolean {
  return args['action'] == null;
}

/** Every key the closed schema declares; the guard refuses anything else as well. */
export const SUBAGENT_TOOL_KEYS: ReadonlySet<string> = new Set(
  Object.keys(SubagentToolParams.properties),
);

/** The hand-off a later chain child receives when its task does not place `{previous}` itself. */
const PREVIOUS_OUTPUT = '\n\nPrevious output:\n{previous}';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withPrevious(child: unknown): unknown {
  if (!isRecord(child)) return child;
  const task = child['task'];
  if (typeof task !== 'string' || task.includes('{previous}')) return child;
  return { ...child, task: `${task}${PREVIOUS_OUTPUT}` };
}

/**
 * Keeps the automatic hand-off of the service's former chain workflow on pi-subagents' native
 * chain, which passes a step the previous output only through a `{previous}` placeholder: every
 * child of a later step (one child or a parallel group) that does not place it gets it appended.
 * The first step has no previous output, so it stays as written.
 */
function chainWithHandOff(chain: unknown): unknown {
  if (!Array.isArray(chain)) return chain;
  return chain.map((step: unknown, index) => {
    if (index === 0 || !isRecord(step)) return step;
    const parallel = step['parallel'];
    return Array.isArray(parallel)
      ? { ...step, parallel: parallel.map(withPrevious) }
      : withPrevious(step);
  });
}

/** One child or chain step with its agent, and its parallel group's, as launched (`launchAgentName`). */
function namedForLaunch(child: Record<string, unknown>): Record<string, unknown> {
  const agent = child['agent'];
  const parallel = child['parallel'];
  return {
    ...child,
    ...(typeof agent === 'string' && { agent: launchAgentName(agent) }),
    ...(Array.isArray(parallel) && { parallel: parallel.map(childForLaunch) }),
  };
}

function childForLaunch(child: unknown): unknown {
  return isRecord(child) ? namedForLaunch(child) : child;
}

/**
 * pi-subagents runs a launch that omits `async` by `asyncByDefault`, and it runs `tasks` and
 * `chain` as one workflow, so a launch that omits it is pinned to the foreground before
 * validation. A null counts as omitted: validation then drops optional nulls, which would
 * otherwise erase the pin. The guard still refuses any launch that does not arrive with
 * async:false. Every child the launch names gets its agent's launch name, so a task agent named
 * as it was defined runs as itself (`launchAgentName`), and a chain gets its previous-output
 * hand-off (`chainWithHandOff`). pi hands these arguments to validation, the guard's `tool_call`
 * and execution; the transcript keeps the call as the model wrote it.
 */
function prepareSubagentArguments(args: unknown): unknown {
  if (!isRecord(args) || args['action'] != null) return args;
  const call = namedForLaunch(args['async'] == null ? { ...args, async: false } : args);
  const tasks = call['tasks'];
  const chain = call['chain'];
  return {
    ...call,
    ...(Array.isArray(tasks) && { tasks: tasks.map(childForLaunch) }),
    ...(Array.isArray(chain) && { chain: chainWithHandOff(chain.map(childForLaunch)) }),
  };
}

/** What one parent session puts on its `subagent` tool besides pi-subagents' execution. */
export interface ServiceSubagentContract {
  /** The model-facing description, with the session's agents (tool-description.ts). */
  description: string;
  /** Handles a define call (task-agents.ts): the result text, or a thrown refusal. */
  define: (toolCallId: string, agents: unknown) => Promise<string>;
}

/**
 * Hands pi-subagents a view of `pi` whose `registerTool` installs the service contract on the
 * `subagent` tool and passes every other registration through untouched. `assertInstalled` fails
 * closed when an upstream change registered the tool some other way, since the model would then
 * see the upstream contract again.
 */
export function withServiceSubagentTool(
  pi: ExtensionAPI,
  contract: ServiceSubagentContract,
): {
  api: ExtensionAPI;
  assertInstalled: () => void;
} {
  let installed = false;
  const registerTool = (tool: ToolDefinition): void => {
    if (tool.name !== SUBAGENT_TOOL) return pi.registerTool(tool);
    installed = true;
    // The upstream definition was built for its own schema; it keeps its renderers and executes
    // every call except a define.
    pi.registerTool<TSchema>({
      ...tool,
      description: contract.description,
      parameters: SubagentToolParams,
      prepareArguments: prepareSubagentArguments,
      // Child cards key on the calling tool call, which a codemode script's nested call lacks.
      exposure: 'model-only',
      // pi-subagents rejects actions it does not know, so the service answers a define itself.
      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        if (!isRecord(params) || params['action'] !== 'define')
          return tool.execute(toolCallId, params, signal, onUpdate, ctx);
        const text = await contract.define(toolCallId, params['agents']);
        return { content: [{ type: 'text', text }], details: undefined };
      },
    });
  };
  const api = new Proxy(pi, {
    get(target, property) {
      if (property === 'registerTool') return registerTool;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    api,
    assertInstalled: () => {
      if (!installed)
        throw new Error('pi-subagents did not register the subagent tool; refusing to start.');
    },
  };
}
