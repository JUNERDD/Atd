import {
  errorMessage,
  type McpServerConfig,
  type RunReference,
  type TaskRun,
} from '@ai/agent-contracts';
import { listAtdAgents, type AtdAgent } from '../atd-agents/catalog.js';
import type { Ledger } from '../ledger.js';
import { mcpProxyPrefix } from '../mcp/index.js';
import type { McpToolSelection } from '../mcp/staging.js';
import { atdRuntimeAgent, type RuntimeAgent } from '../subagents/agents.js';
import { CONTEXT_BUDGET, runInputSize } from '../tasks/run-budget.js';
import {
  clip,
  CONVERSATION_EXCERPT_CHARS,
  excerptConversation,
  readConversation,
  type Conversation,
} from './conversation.js';

/** Conversations one run may reference; later ones are listed as unavailable. */
const MAX_TASK_REFERENCES = 3;
/** Below this, an excerpt says too little; the conversation is listed as unavailable. */
const MIN_EXCERPT_CHARS = 1000;
/** Characters of an agent description repeated in its delegation hint. */
const DESCRIPTION_CHARS = 400;
const SEPARATOR = '\n\n';
const INTRO = 'The user referenced the following with @ in this message.';
const NOTES_HEADER = 'Unavailable references (tell the user when this matters for the answer):';

/** What the run freeze knows when it resolves references. */
export interface ReferenceContext {
  ledger: Ledger;
  /** The task whose run is freezing. */
  taskId: string;
  run: TaskRun;
  /** The run's child tool ceiling: its frozen role capabilities. */
  toolCeiling: string[];
  /** Characters the run's skills take from the context budget first (skills/run-skills.ts). */
  skillChars: number;
  /** Configured servers and the run's frozen tool selection; null while MCP is unavailable. */
  mcp: { servers: McpServerConfig[]; selected: McpToolSelection[] | null } | null;
  /** Catalog agents turned off in Settings (atd-agents/enablement.ts); a reference to one resolves to a note. */
  disabledAgents: ReadonlySet<string>;
}

/** A run's references resolved at freeze into material and capabilities. */
export interface RunReferences {
  /** Text appended to the run material; empty when the run has no references. */
  material: string;
  /** `~/.atd/agents` specialists the run's session registers and allows. */
  agents: RuntimeAgent[];
  /** One record per staged reference plus a summary, for the run audit. */
  audit: Record<string, unknown>[];
}

interface Note {
  reference: RunReference;
  label: string;
  reason: string;
}

interface Hint {
  reference: RunReference;
  text: string;
  audit: Record<string, unknown>;
  agent?: RuntimeAgent;
}

interface Source {
  reference: RunReference;
  title: string;
  conversation: Conversation;
}

/**
 * Resolves a run's staged references. A reference that no longer resolves
 * never fails the run: it is listed as unavailable with its reason, so the
 * model can tell the user. Everything the references add counts against the
 * context budget left by the run's own input and its skills (tasks/run-budget.ts).
 */
export async function resolveRunReferences(
  context: ReferenceContext,
  references: RunReference[],
): Promise<RunReferences> {
  if (!references.length) return { material: '', agents: [], audit: [] };
  const notes: Note[] = [];
  const hints: Hint[] = [];
  const sources: Source[] = [];
  let catalog: Promise<AtdAgent[] | string> | null = null;
  for (const reference of references) {
    if (reference.kind === 'task') {
      if (sources.length >= MAX_TASK_REFERENCES) {
        const reason = `only ${MAX_TASK_REFERENCES} conversations can be referenced per message`;
        notes.push({ reference, label: taskLabel(context, reference.taskId), reason });
        continue;
      }
      const resolved = await resolveTask(context, reference.taskId);
      if ('reason' in resolved) notes.push({ reference, ...resolved });
      else sources.push({ reference, ...resolved });
    } else if (reference.kind === 'mcpServer') {
      const resolved = resolveMcpServer(context, reference.serverId);
      const label = `MCP server "${reference.serverId}"`;
      if (typeof resolved === 'string') notes.push({ reference, label, reason: resolved });
      else hints.push({ reference, ...resolved });
    } else {
      catalog ??= listAtdAgents().then(
        ({ agents }) => agents,
        (error: unknown) => `the agent catalog could not be read (${errorMessage(error)})`,
      );
      const resolved = context.disabledAgents.has(reference.name)
        ? 'it is turned off in Settings'
        : resolveAgent(await catalog, reference.name, context.toolCeiling);
      const label = `Agent "${reference.name}"`;
      if (typeof resolved === 'string') notes.push({ reference, label, reason: resolved });
      else hints.push({ reference, ...resolved });
    }
  }
  return compose(context, { notes, hints, sources });
}

/** Fits excerpts into the budget room, most recent turns first, and renders the material. */
function compose(
  context: ReferenceContext,
  parts: { notes: Note[]; hints: Hint[]; sources: Source[] },
): RunReferences {
  const room = CONTEXT_BUDGET - runInputSize(context.run.snapshot) - context.skillChars;
  const excerpts = new Map<Source, { text: string; audit: Record<string, unknown> }>();
  const noRoom = (source: Source): Note => ({
    reference: source.reference,
    label: `Conversation "${source.title}"`,
    reason: 'this message leaves no room for it',
  });
  const view = () =>
    render(
      parts.sources.flatMap((source) => excerpts.get(source)?.text ?? []),
      parts.hints.map((hint) => hint.text),
      [...parts.notes, ...parts.sources.filter((source) => !excerpts.has(source)).map(noRoom)],
    );
  if (view().length > room) return skipAll(parts, room);
  for (const source of parts.sources) {
    const header = `Conversation "${source.title}", excerpt:\n<conversation-excerpt>\n`;
    const footer = '\n</conversation-excerpt>';
    const spare = room - view().length + noteLine(noRoom(source)).length;
    const cap = Math.min(
      CONVERSATION_EXCERPT_CHARS,
      spare - header.length - footer.length - SEPARATOR.length,
    );
    if (cap < MIN_EXCERPT_CHARS) continue;
    const excerpt = excerptConversation(source.conversation, cap);
    excerpts.set(source, {
      text: `${header}${excerpt.text}${footer}`,
      audit: {
        ...target(source.reference),
        decision: 'included',
        chars: excerpt.text.length,
        keptTurns: excerpt.keptTurns,
        omittedTurns: excerpt.omittedTurns,
      },
    });
  }
  const notes = [
    ...parts.notes,
    ...parts.sources.filter((source) => !excerpts.has(source)).map(noRoom),
  ];
  const material = view();
  return {
    material,
    agents: parts.hints.flatMap((hint) => (hint.agent ? [hint.agent] : [])),
    audit: [
      ...[...excerpts.values()].map((excerpt) => excerpt.audit),
      ...parts.hints.map((hint) => hint.audit),
      ...notes.map((note) => ({
        ...target(note.reference),
        decision: 'unavailable',
        reason: note.reason,
      })),
      {
        references: parts.notes.length + parts.hints.length + parts.sources.length,
        unavailable: notes.length,
        referenceChars: material.length,
        budgetRoom: room,
      },
    ],
  };
}

/** Even the notes alone overflow the room: the run gets no reference material. */
function skipAll(
  parts: { notes: Note[]; hints: Hint[]; sources: Source[] },
  room: number,
): RunReferences {
  const all = [...parts.notes, ...parts.hints, ...parts.sources].map((part) => part.reference);
  return {
    material: '',
    agents: [],
    audit: [
      ...all.map((reference) => ({
        ...target(reference),
        decision: 'skipped',
        reason: 'the message leaves no room in the context budget',
      })),
      { references: all.length, unavailable: all.length, referenceChars: 0, budgetRoom: room },
    ],
  };
}

function render(excerpts: string[], hints: string[], notes: Note[]): string {
  const noteBlock = notes.length ? [`${NOTES_HEADER}\n${notes.map(noteLine).join('\n')}`] : [];
  return [INTRO, ...excerpts, ...hints, ...noteBlock].join(SEPARATOR);
}

function noteLine(note: Note): string {
  return `- ${note.label}: ${note.reason}.`;
}

async function resolveTask(
  context: ReferenceContext,
  taskId: string,
): Promise<{ title: string; conversation: Conversation } | { label: string; reason: string }> {
  const label = taskLabel(context, taskId);
  if (taskId === context.taskId) return { label, reason: 'it is the current conversation' };
  const task = context.ledger.data.tasks.find((item) => item.id === taskId);
  if (!task) return { label, reason: 'it no longer exists' };
  if (!task.sessionFile) return { label, reason: 'it has no messages yet' };
  try {
    const conversation = await readConversation(task.sessionFile);
    if (!conversation.turns.length) return { label, reason: 'it has no messages yet' };
    return { title: oneLine(task.title), conversation };
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    return {
      label,
      reason: missing ? 'its conversation file is missing' : 'its conversation could not be read',
    };
  }
}

function resolveMcpServer(
  context: ReferenceContext,
  serverId: string,
): Omit<Hint, 'reference'> | string {
  if (!context.mcp) return 'MCP is unavailable in this service';
  const server = context.mcp.servers.find((item) => item.serverId === serverId);
  if (!server) return 'it is not configured';
  if (server.disabled) return 'it is disabled';
  const selected = context.mcp.selected;
  if (selected && !selected.some((tool) => tool.connectionId === server.connectionId))
    return 'none of its tools are selected for this message';
  const prefix = mcpProxyPrefix(serverId);
  return {
    text: `MCP server "${serverId}": prefer its tools, the ones named ${prefix}*, where they fit this request. Every other tool stays available.`,
    audit: { reference: 'mcpServer', target: serverId, decision: 'included', prefix },
  };
}

function resolveAgent(
  catalog: AtdAgent[] | string,
  name: string,
  ceiling: string[],
): Omit<Hint, 'reference'> | string {
  if (typeof catalog === 'string') return catalog;
  const entry = catalog.find((agent) => agent.name === name);
  if (!entry) return 'it is not in ~/.atd/agents';
  const runtime = atdRuntimeAgent(entry, ceiling);
  if ('reason' in runtime) return runtime.reason;
  const { agent } = runtime;
  const tools = agent.definition.tools ?? [];
  const call = JSON.stringify({ agent: agent.name, task: '<what to do>', async: false });
  return {
    agent,
    text: [
      `Agent "${agent.name}" (${name} from ~/.atd/agents): ${clip(oneLine(entry.description), DESCRIPTION_CHARS)}`,
      `Delegate work that suits it with the subagent tool: ${call}. ${tools.length ? `Its tools: ${tools.join(', ')}.` : 'It has no tools in this run.'}`,
    ].join('\n'),
    audit: {
      reference: 'agent',
      target: name,
      decision: 'included',
      registeredAs: agent.name,
      tools,
      ignoredModel: entry.model,
    },
  };
}

function taskLabel(context: ReferenceContext, taskId: string): string {
  const task = context.ledger.data.tasks.find((item) => item.id === taskId);
  return task ? `Conversation "${oneLine(task.title)}"` : `Conversation ${taskId}`;
}

/** Titles and descriptions are user text; labels and hints stay on one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function target(reference: RunReference): { reference: string; target: string } {
  switch (reference.kind) {
    case 'task':
      return { reference: 'task', target: reference.taskId };
    case 'agent':
      return { reference: 'agent', target: reference.name };
    case 'mcpServer':
      return { reference: 'mcpServer', target: reference.serverId };
  }
}
