import type { RunPolicy } from './run-policy';
import { randomUUID } from 'node:crypto';
import type { CommandDefinition } from './command-schema';
import type { SubmitRequest } from './bridge';
import {
  isActive,
  runThinkingLevel,
  type ResolvedModel,
  type RunSnapshot,
  type TaskInput,
} from './task-schema';
import { errorMessage } from './validation';
import { resolveInstructions } from './command-validation';
import { TaskRuntime } from './task-runtime';
import type { ModelReference, ModelThinkingLevel } from '../providers/schema';

export class RunService {
  private accepting: Promise<void> = Promise.resolve();
  constructor(
    private runtime: TaskRuntime,
    private model: (
      command: CommandDefinition | null,
      reference?: ModelReference,
    ) => Promise<ResolvedModel>,
    private assertModel: (model: ResolvedModel) => void,
    private thinkingLevel: (
      model: ResolvedModel,
      requested?: ModelThinkingLevel,
    ) => Promise<ModelThinkingLevel>,
  ) {}

  async preview(
    input: TaskInput,
    command: CommandDefinition | null,
    policy: RunPolicy | null = null,
  ): Promise<RunSnapshot> {
    const files = await this.runtime.resources.resolve(input.files);
    if (!command && !input.text.trim() && input.files.length === 0)
      throw new Error('Enter a message or attach a file.');
    const model = await this.model(
      policy?.useDefaultModel ? null : command,
      policy?.useDefaultModel ? undefined : policy?.model,
    );
    const snapshot = await this.applyPolicy(
      {
        command,
        definition: 'current',
        input,
        instructions: command ? resolveInstructions(command, input) : '',
        model,
        thinkingLevel: await this.freezeThinkingLevel(model, policy, command),
        tools: command?.tools ?? ['read', 'write', 'edit', 'bash', 'command'],
        memory: command?.memory !== 'off',
      },
      policy,
      false,
    );
    this.checkBudget(snapshot, files);
    return snapshot;
  }

  /**
   * The level a new snapshot freezes: an explicit policy level wins, else a
   * fixed-model command's pinned level, else the connection's saved default.
   */
  private freezeThinkingLevel(
    model: ResolvedModel,
    policy: RunPolicy | null,
    command: CommandDefinition | null,
  ): Promise<ModelThinkingLevel> {
    const requested =
      policy?.thinkingLevel ??
      (command?.model.mode === 'fixed' ? command.model.thinkingLevel : undefined);
    return this.thinkingLevel(model, requested);
  }

  private checkBudget(snapshot: RunSnapshot, files: { text: string }[]) {
    const size =
      snapshot.input.text.length +
      snapshot.instructions.length +
      JSON.stringify(snapshot.input.arguments).length +
      files.reduce((total, file) => total + file.text.length, 0);
    if (size > 120000)
      throw new Error(
        'The combined input, parameters and files exceed the context budget. Shorten the input or choose smaller files.',
      );
  }

  private async applyPolicy(
    snapshot: RunSnapshot,
    policy: RunPolicy | null,
    resolveModel = true,
  ): Promise<RunSnapshot> {
    if (!policy) return snapshot;
    const { tools, memory, useDefaultModel, confirmExpansion } = policy;
    if (
      (tools.some((tool) => !snapshot.tools.includes(tool)) || (memory && !snapshot.memory)) &&
      !confirmExpansion
    )
      throw new Error('Confirm the additional task capabilities before running.');
    // Re-resolving the model re-resolves the level from the new connection's default;
    // an explicit policy level re-resolves it for the model that stays selected.
    const reResolved = resolveModel && Boolean(policy.model || useDefaultModel);
    const model = reResolved
      ? await this.model(null, useDefaultModel ? undefined : policy.model)
      : snapshot.model;
    return {
      ...snapshot,
      tools,
      memory,
      model,
      thinkingLevel:
        reResolved || policy.thinkingLevel
          ? await this.thinkingLevel(model, policy.thinkingLevel)
          : runThinkingLevel(snapshot),
    };
  }

  submit(request: SubmitRequest) {
    const pending = this.accepting.then(() => this.accept(request));
    this.accepting = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async accept(request: SubmitRequest) {
    const store = this.runtime.store;
    const duplicate = store.data.tasks.find((task) =>
      task.runs.some((run) => run.invocationId === request.invocationId),
    );
    if (duplicate) return this.runtime.detail(duplicate.id);
    const previous = request.taskId ? this.runtime.task(request.taskId) : null;
    if (previous?.runs.some((run) => isActive(run.status)))
      throw new Error('Wait for this task to finish, or stop it before sending another message.');
    let snapshot: RunSnapshot;
    if (previous && previous.runs.length) {
      const saved = previous.runs.at(-1)!.snapshot;
      if (!request.input.text.trim() && !request.input.files.length)
        throw new Error('Enter a follow-up.');
      snapshot = { ...saved, input: request.input };
      this.checkBudget(snapshot, await this.runtime.resources.resolve(request.input.files));
    } else if (request.savedRun) {
      const saved = this.runtime
        .task(request.savedRun.taskId)
        .runs.find((run) => run.id === request.savedRun!.runId);
      if (!saved) throw new Error('The saved command version is unavailable.');
      snapshot = { ...saved.snapshot, definition: 'saved', input: request.input };
      if (snapshot.command)
        snapshot.instructions = resolveInstructions(snapshot.command, request.input);
      this.checkBudget(snapshot, await this.runtime.resources.resolve(request.input.files));
    } else {
      const command = request.commandId
        ? store.data.commands.find((command) => command.id === request.commandId)
        : null;
      if (
        request.commandId &&
        (!command || !command.enabled || command.revision !== request.commandRevision)
      )
        throw new Error(
          'This command changed or was disabled. Review the latest command before starting.',
        );
      snapshot = await this.preview(request.input, command ?? null, request.policy);
    }
    if (previous || request.savedRun) snapshot = await this.applyPolicy(snapshot, request.policy);
    // Resolve the connection now as well as at dequeue. A snapshot cannot grant a new endpoint credentials.
    this.assertModel(snapshot.model);
    const id = previous?.id ?? randomUUID();
    await this.runtime.resources.adopt(id, snapshot.input.files);
    const now = new Date().toISOString();
    await store.change((data) => {
      if (!previous && !request.savedRun && snapshot.command) {
        const current = data.commands.find((command) => command.id === snapshot.command?.id);
        if (!current?.enabled || current.revision !== request.commandRevision)
          throw new Error('This command changed before acceptance. Review the latest version.');
      }
      let task = data.tasks.find((task) => task.id === id);
      if (!task) {
        task = {
          id,
          title:
            snapshot.command?.name ??
            (snapshot.input.text.trim().slice(0, 120) ||
              snapshot.input.files[0]?.name ||
              'New task'),
          createdAt: now,
          updatedAt: now,
          sessionFile: null,
          runs: [],
          legacy: null,
        };
        data.tasks.unshift(task);
      }
      task.runs.push({
        id: randomUUID(),
        invocationId: request.invocationId,
        createdAt: now,
        status: 'queued',
        error: '',
        snapshot,
      });
      task.updatedAt = now;
    });
    const detail = this.runtime.cachedDetail(id);
    this.runtime.publishTask(id);
    void this.runtime.drain().catch((error) => {
      this.runtime.error = errorMessage(error);
      this.runtime.publishTask(id);
    });
    return detail;
  }
}
