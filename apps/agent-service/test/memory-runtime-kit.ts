import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import type { MemoryTarget, MemoryUnit } from '@atd/agent-contracts';
import type {
  LearnerCommit,
  MemoryHit,
  MemoryRunScope,
  MemoryRuntimeStore,
  MemoryUnitInput,
  MemoryUnitPatch,
} from '../dist/memory/engine-types.js';

/**
 * Fixtures of the memory run integration tests (memory-runtime-*.test.ts): units, a store that
 * keeps the `MemoryRuntimeStore` contract over a list, and a session on a faux model.
 */

export function unit(name: string, fields: Partial<MemoryUnit> = {}): MemoryUnit {
  return {
    id: randomUUID(),
    name,
    description: `What ${name} holds and when it applies.`,
    type: 'memory',
    category: null,
    activation: 'index',
    enabled: true,
    source: 'user',
    origin: null,
    reviewed: true,
    created: '2026-10-01T08:00:00.000Z',
    updated: '2026-10-02T09:30:00.000Z',
    body: `The body of ${name}.`,
    revision: 'revision-1',
    ...fields,
  };
}

export function rootScope(runId = 'run-1', runMemory = true): MemoryRunScope {
  return { runMemory, executionId: `root:${runId}`, taskId: 'task-1', runId };
}

const TYPE_ORDER = { user: 0, memory: 1, failure: 2 } as const;

/**
 * The store contract over a list: enabled units in its order (type `user`, `memory`, `failure`,
 * then name), learning for root executions while not `paused`. `reads` counts enabledUnits
 * calls; `calls` records the searches and writes the tools asked for.
 */
export class FakeStore implements MemoryRuntimeStore {
  paused = false;
  reads = 0;
  readonly calls: unknown[][] = [];
  readonly units: MemoryUnit[];
  constructor(units: MemoryUnit[]) {
    this.units = units;
  }
  canRead(scope: MemoryRunScope): boolean {
    return scope.runMemory;
  }
  canLearn(scope: MemoryRunScope): boolean {
    return scope.runMemory && !this.paused && scope.executionId.startsWith('root:');
  }
  currentPolicyVersion(): number {
    return 0;
  }
  async enabledUnits(): Promise<MemoryUnit[]> {
    this.reads += 1;
    return this.units
      .filter((item) => item.enabled)
      .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || (a.name < b.name ? -1 : 1));
  }
  async search(
    query: string,
    options: { type?: MemoryTarget; limit: number },
  ): Promise<MemoryHit[]> {
    this.calls.push(['search', query, options]);
    const term = query.toLowerCase();
    return this.units
      .filter((item) => item.enabled && (!options.type || item.type === options.type))
      .filter((item) =>
        `${item.name} ${item.description} ${item.body}`.toLowerCase().includes(term),
      )
      .slice(0, options.limit)
      .map((item) => ({ unit: item, snippet: item.body }));
  }
  async readByName(name: string): Promise<MemoryUnit | null> {
    return this.units.find((item) => item.enabled && item.name === name) ?? null;
  }
  /** Like the authority, a tool's request for `core` leaves the unit in the index. */
  async addFromTool(input: MemoryUnitInput, scope: MemoryRunScope): Promise<MemoryUnit> {
    this.calls.push(['add', input, scope]);
    const { name = `memory-${this.units.length}`, category = null, ...rest } = input;
    const activation = rest.activation === 'search' ? 'search' : 'index';
    const added = unit(name, { ...rest, activation, category, source: 'agent' });
    this.units.push(added);
    return added;
  }
  async replaceFromTool(
    name: string,
    patch: MemoryUnitPatch,
    scope: MemoryRunScope,
  ): Promise<MemoryUnit> {
    this.calls.push(['replace', name, patch, scope]);
    const index = this.units.findIndex((item) => item.name === name);
    const current = this.units[index];
    assert.ok(current, `${name} exists`);
    const { category = current.category, activation = current.activation, ...rest } = patch;
    // Like the authority, a tool never moves a unit into or out of `core`.
    const crossesCore = (activation === 'core') !== (current.activation === 'core');
    const replaced = {
      ...current,
      ...rest,
      category,
      activation: crossesCore ? current.activation : activation,
    };
    this.units[index] = replaced;
    return replaced;
  }
  async removeFromTool(name: string, scope: MemoryRunScope): Promise<void> {
    this.calls.push(['remove', name, scope]);
    this.units.splice(
      this.units.findIndex((item) => item.name === name),
      1,
    );
  }
  async commitLearned(): Promise<LearnerCommit> {
    return { applied: 0, proposed: 0, skipped: [] };
  }
}

/** The arguments of a tool call the faux model makes. */
type ToolArgs = Parameters<typeof fauxToolCall>[1];

/** One tool call's result as the session recorded it. */
export interface Outcome {
  isError: boolean;
  text: string;
  details: unknown;
}

/**
 * A session under `scratch` with `extensions`, a short custom system prompt and `tools`
 * allowlisted and active. `prompt` runs one prompt in which the faux model makes `calls` (when
 * any) and then answers, and returns each call's outcome; `sent` collects the system prompt of
 * every model request.
 */
export async function openSession(
  scratch: string,
  extensions: ExtensionFactory[],
  tools: string[],
) {
  const cwd = await mkdtemp(path.join(scratch, 'task-'));
  const manager = SessionManager.inMemory(cwd);
  const faux = fauxProvider();
  const models = await ModelRuntime.create({
    authPath: path.join(scratch, 'auth.json'),
    modelsPath: null,
    modelsStorePath: path.join(scratch, 'models-cache.json'),
    refreshOnCreate: false,
  });
  models.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: scratch,
    agentDir: scratch,
    settingsManager,
    noSkills: true,
    noContextFiles: true,
    systemPrompt: 'You are a test assistant.',
    extensionFactories: extensions,
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: scratch,
    modelRuntime: models,
    model: faux.getModel(),
    settingsManager,
    sessionManager: manager,
    resourceLoader: loader,
    tools,
  });
  session.setActiveToolsByName(tools);
  await session.bindExtensions({ mode: 'json' });
  const sent: string[] = [];
  const answer =
    (message: ReturnType<typeof fauxAssistantMessage>) => (context: TranscriptContext) => {
      sent.push(getCurrentSystemPrompt(context.messages));
      return message;
    };
  let next = 0;
  const prompt = async (calls: Array<[string, ToolArgs]> = []): Promise<Outcome[]> => {
    const ids = calls.map(() => `call-${next++}`);
    const toolCalls = calls.map(([name, args], index) =>
      fauxToolCall(name, args, { id: ids[index] ?? '' }),
    );
    faux.appendResponses([
      ...(calls.length ? [answer(fauxAssistantMessage(toolCalls, { stopReason: 'toolUse' }))] : []),
      answer(fauxAssistantMessage('done')),
    ]);
    await session.prompt('Go on.');
    return ids.map((id) => outcomeOf(manager, id));
  };
  return { session, manager, prompt, sent };
}

function outcomeOf(manager: SessionManager, id: string): Outcome {
  for (const entry of manager.getBranch()) {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') continue;
    if (entry.message.toolCallId !== id) continue;
    const text = entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
    return { isError: entry.message.isError, text: text.join(''), details: entry.message.details };
  }
  assert.fail(`${id} has a result`);
}
