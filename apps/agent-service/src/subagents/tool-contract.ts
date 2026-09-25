import {
  ChainWorkflowArgsSchema,
  ParallelWorkflowArgsSchema,
  SUBAGENT_WORKFLOWS,
} from '@ai/agent-contracts';
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type TSchema } from 'typebox';

/**
 * The service-owned model contract of pi-subagents' `subagent` tool. Upstream advertises its whole
 * surface (raw workflow scripts, async runs, guides, missions…), most of which the service guard
 * refuses, so models kept calling shapes that could only fail. The service swaps in a description
 * and a closed schema that list exactly the calls the guard admits; pi-subagents still executes
 * them, and the guard stays the authority on what a call may do.
 */

export const SUBAGENT_TOOL = 'subagent';

/** Management actions a parent may call; everything else launches children or is refused. */
export const SUBAGENT_ACTIONS = ['list', 'status'] as const;

/** Keys each action may carry besides `action`. */
export const SUBAGENT_ACTION_KEYS: Readonly<
  Record<(typeof SUBAGENT_ACTIONS)[number], readonly string[]>
> = {
  list: ['capabilities'],
  status: ['id'],
};

/**
 * Closed parameter schema: pi rejects any other key before the guard runs. `async` stays declared so
 * a habitual `async:false` validates; the guard refuses `async:true` with a readable reason.
 * Enums rather than literal unions keep a wrong value to one validation message.
 */
export const SubagentToolParams = Type.Object(
  {
    agent: Type.Optional(Type.String({ description: 'One child: the agent to run.' })),
    task: Type.Optional(
      Type.String({
        description: 'One child: the complete, self-contained task (1-8000 characters).',
      }),
    ),
    workflow: Type.Optional(
      Type.Enum([...SUBAGENT_WORKFLOWS], {
        description: 'Several children: service.parallel or service.chain; pass args.',
      }),
    ),
    args: Type.Optional(
      Type.Union([ParallelWorkflowArgsSchema, ChainWorkflowArgsSchema], {
        description:
          'service.parallel: { tasks: [{ agent, task }, ...] }. service.chain: { steps: [{ agent, task }, ...] } (1-4 steps).',
      }),
    ),
    async: Type.Optional(
      Type.Boolean({ description: 'Omit it or pass false: every call runs in the foreground.' }),
    ),
    timeoutMs: Type.Optional(
      Type.Integer({ minimum: 1, description: 'Optional deadline for the launch.' }),
    ),
    action: Type.Optional(
      Type.Enum([...SUBAGENT_ACTIONS], {
        description: 'Inspect instead of launching: list or status.',
      }),
    ),
    capabilities: Type.Optional(
      Type.Boolean({ description: 'list only: include each agent’s tools and model.' }),
    ),
    id: Type.Optional(Type.String({ minLength: 1, description: 'status: the run id to report.' })),
  },
  { additionalProperties: false },
);

/** Every key the closed schema declares; the guard refuses anything else as well. */
export const SUBAGENT_TOOL_KEYS: ReadonlySet<string> = new Set(
  Object.keys(SubagentToolParams.properties),
);

export const SUBAGENT_TOOL_DESCRIPTION = [
  'Delegate bounded work to child subagents. Children start with fresh context: they do not see this conversation, cannot delegate further, and return their result to you.',
  '',
  'Pass exactly one of these shapes:',
  '- One child: { agent, task }',
  '- Several children at the same time: { workflow: "service.parallel", args: { tasks: [{ agent, task }, ...] } }',
  '- Children in order, each receiving the previous output: { workflow: "service.chain", args: { steps: [{ agent, task }, ...] } } (1-4 steps)',
  '- Inspect: { action: "list", capabilities: true } lists the agents you may call with their tools; { action: "status", id } reports a run.',
  '',
  'Rules:',
  '- Every launch runs in the foreground and returns when its children finish; async:true is refused.',
  '- Launch at most one subagent call at a time: a second launch while one runs is rejected, so put independent work in one service.parallel call.',
  '- agent must be one of the agents available in this session. Give each task everything the child needs.',
  '- Workflow tasks may also carry a label and resources (ids of attached materials).',
].join('\n');

/**
 * pi-subagents detaches a named workflow launched without `async` (asyncByDefault only covers single
 * children), so a launch that omits it is pinned to the foreground before validation. A null counts
 * as omitted: validation then drops optional nulls, which would otherwise erase the pin. The guard
 * still refuses any launch that does not arrive with async:false.
 */
function foregroundByDefault(args: unknown): unknown {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return args;
  const call = args as Record<string, unknown>;
  return call['action'] == null && call['async'] == null ? { ...call, async: false } : call;
}

/**
 * Hands pi-subagents a view of `pi` whose `registerTool` installs the service contract on the
 * `subagent` tool and passes every other registration through untouched. `assertInstalled` fails
 * closed when an upstream change registered the tool some other way, since the model would then
 * see the upstream contract again.
 */
export function withServiceSubagentTool(pi: ExtensionAPI): {
  api: ExtensionAPI;
  assertInstalled(): void;
} {
  let installed = false;
  const registerTool = (tool: ToolDefinition): void => {
    if (tool.name !== SUBAGENT_TOOL) return pi.registerTool(tool);
    installed = true;
    // The upstream definition was built for its own schema; it keeps its execute and renderers.
    pi.registerTool<TSchema>({
      ...tool,
      description: SUBAGENT_TOOL_DESCRIPTION,
      parameters: SubagentToolParams,
      prepareArguments: foregroundByDefault,
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
