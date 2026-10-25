import { randomUUID } from 'node:crypto';
import { Compile } from 'typebox/compile';
import {
  errorMessage,
  isTerminalStatus,
  parse,
  RunStatusDataSchema,
  SubmitTaskRequestSchema,
  type Automation,
  type ComputerRunTrial,
  type ComputerTrialRequest,
  type ComputerTrialResponse,
  type ServiceEvent,
  type SubmitTaskResponse,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import type { EventLog } from '../event-log.js';
import { LedgerNotFound, type Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { InternalSubmitOptions } from '../tasks/submit-options.js';
import { lookups, type Lookups } from './checks.js';
import { fingerprintOf } from './computer-approval.js';
import type { AutomationComputer } from './computer-deps.js';
import {
  definitionHash,
  engineProfilesHash,
  liveBindingHashes,
  recipeHash,
} from './computer-grant.js';
import type { ComputerTrials, PendingTrial } from './computer-trials.js';
import { baseInput, PROMPT_TOOLS, runFolderIds, type LaunchDeps } from './launch-run.js';
import { oneLine } from './untrusted.js';
import type { AutomationStore } from './store.js';

/**
 * Attended trials of an automation's saved recipe (plan §3.3 step 3). A trial is an ordinary
 * visible task a person starts and watches: it has no trigger, so it is attended, and the gate
 * asks as it would in any run; it acts only through the frozen recipe (`RunComputer.trial`). When
 * its run ends, however it ended, the trial is judged from the host-verified facts alone and
 * recorded (computer-trials.ts); nothing the agent says can make it pass.
 */

const RunStatusData = Compile(RunStatusDataSchema);

export interface TrialRunDeps {
  store: AutomationStore;
  trials: ComputerTrials;
  computer: AutomationComputer;
  events: Pick<EventLog, 'onPublish'>;
  ledger: Pick<Ledger, 'run'>;
  launch: LaunchDeps;
  lookups: () => Pick<Lookups, 'command'>;
  log: Logger;
  now: () => number;
  /** A trial was recorded: the approval details changed. */
  changed: () => void;
}

/** The note in front of a trial's instructions. */
function trialContext(automation: Automation): string {
  return [
    '<automation-trial>',
    `Automation: ${oneLine(automation.name, 120)}`,
    'This is an attended trial of the automation: the person is present and watching, and every action takes real effect. Act on the computer only through the steps of its recipe, naming each step by its id, and stop once its completion condition holds. The trial passes only if the computer host verifies each step and the completion.',
    '</automation-trial>',
  ].join('\n');
}

export class TrialRuns {
  private unsubscribe: (() => void) | null = null;
  private readonly settling = new Map<string, Promise<void>>();

  constructor(private readonly deps: TrialRunDeps) {}

  /** Listens for trial runs ending, and judges the ones that ended while nobody listened. */
  listen(): void {
    this.unsubscribe ??= this.deps.events.onPublish((event) => this.onEvent(event));
    for (const pending of this.deps.trials.pending) this.settleIfEnded(pending);
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async idle(): Promise<void> {
    while (this.settling.size) await Promise.all(this.settling.values());
  }

  /** POST `/v1/automations/:id/computer-trial`. */
  async start(id: string, request: ComputerTrialRequest): Promise<ComputerTrialResponse> {
    const { store, trials, computer } = this.deps;
    const automation = store.data.definitions.automations.find((item) => item.id === id);
    if (!automation) throw new LedgerNotFound('Automation', id);
    if (automation.revision !== request.expectedRevision)
      throw new ConflictError('This automation changed. Reload it before trying it.');
    const policy = automation.policy.computer;
    if (!policy) throw new TypeError('Invalid automation: it requests no computer scope.');
    if (store.data.state.automations[id]?.computerHold)
      throw new ConflictError('Review the run that left computer actions unresolved first.');
    if (trials.problem) throw new ConflictError(trials.problem);
    if (trials.running(id)) throw new ConflictError('A trial of this automation is running.');
    const bindingHashes = liveBindingHashes(policy, computer.bindings);
    if (!bindingHashes) throw new TypeError('Invalid automation: a computer target is gone.');
    const engines = engineProfilesHash(policy, computer.bindings, computer.profiles());
    if (!engines) throw new ConflictError('The computer host is not ready to run this trial.');
    const fingerprint = await fingerprintOf(automation, this.deps.lookups());
    const trial: ComputerRunTrial = {
      automationId: id,
      trialId: randomUUID(),
      definitionHash: definitionHash(automation),
      recipeHash: recipeHash(policy.recipe),
      bindingHashes,
    };
    const accepted = await this.submit(automation, trial, fingerprint);
    const pending: PendingTrial = {
      trial,
      engineProfilesHash: engines,
      policy,
      taskId: accepted.taskId,
      runId: accepted.runId,
      startedAt: new Date(this.deps.now()).toISOString(),
    };
    await trials.begin(pending);
    // The run may have ended before the trial was recorded as waiting on it.
    this.settleIfEnded(pending);
    return { trialId: trial.trialId, taskId: accepted.taskId, runId: accepted.runId };
  }

  private submit(
    automation: Automation,
    trial: ComputerRunTrial,
    fingerprint: string | undefined,
  ): Promise<SubmitTaskResponse> {
    const { launch } = this.deps;
    const { policy, action } = automation;
    const computer = policy.computer;
    if (!computer || action.kind === 'consolidateMemory')
      throw new TypeError('Invalid automation: it cannot act on the computer.');
    const internal: InternalSubmitOptions = {
      title: `Trial · ${automation.name}`,
      computer: { bindingIds: computer.bindingIds, trial },
    };
    const operationId = `trial_${trial.trialId}`;
    const now = new Date(this.deps.now()).toISOString();
    const folders = runFolderIds(automation);
    const picks = {
      ...(policy.model ? { model: policy.model } : {}),
      ...(policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
      memory: policy.memory,
    };
    if (action.kind === 'prompt') {
      const text = `${trialContext(automation)}\n\n${action.prompt.trim()}`;
      const submit = parse(SubmitTaskRequestSchema, {
        operationId,
        input: baseInput(text, now, folders),
        ...picks,
        tools: policy.tools ?? PROMPT_TOOLS,
      });
      return launch.manager.submit(submit, internal);
    }
    return launch.launchCommand(
      {
        commandId: action.commandId,
        operationId,
        input: { ...baseInput(action.input, now, folders), arguments: action.arguments },
        frame: { before: trialContext(automation) },
        policy: picks,
        ...(fingerprint ? { expectedFingerprint: fingerprint } : {}),
      },
      internal,
    );
  }

  private onEvent(event: ServiceEvent): void {
    if (event.type !== 'run.status' || !event.runId || !RunStatusData.Check(event.data)) return;
    if (!isTerminalStatus(event.data.status)) return;
    const pending = this.deps.trials.pending.find((item) => item.runId === event.runId);
    if (pending) this.settle(pending);
  }

  private settleIfEnded(pending: PendingTrial): void {
    let ended = true;
    try {
      ended = isTerminalStatus(this.deps.ledger.run(pending.taskId, pending.runId).status);
    } catch {
      // The task was deleted: judge the trial from whatever facts it left.
    }
    if (ended) this.settle(pending);
  }

  private settle(pending: PendingTrial): void {
    if (this.settling.has(pending.runId)) return;
    const work = this.deps.computer
      .readRunFacts(pending.runId)
      .then((facts) =>
        this.deps.trials.finish(pending.runId, facts, new Date(this.deps.now()).toISOString()),
      )
      .then((recorded) => {
        if (recorded) this.deps.changed();
      })
      .catch((error: unknown) => {
        this.deps.log.warn('A computer trial could not be recorded.', {
          automationId: pending.trial.automationId,
          error: errorMessage(error),
        });
      })
      .finally(() => this.settling.delete(pending.runId));
    this.settling.set(pending.runId, work);
  }
}

/** The trial runner of a service with computer use, over the service's own run pipeline. */
export function trialRunsFor(
  deps: Pick<TrialRunDeps, 'events' | 'ledger' | 'log'> & {
    paths: { root: string };
    manager: LaunchDeps['manager'];
    launchCommand: LaunchDeps['launchCommand'];
    folders: LaunchDeps['folders'];
    resources: LaunchDeps['resources'];
  },
  computer: AutomationComputer,
  store: AutomationStore,
  trials: ComputerTrials,
  now: () => number,
  changed: () => void,
): TrialRuns {
  const { paths, manager, launchCommand, folders, resources } = deps;
  return new TrialRuns({
    store,
    trials,
    computer,
    events: deps.events,
    ledger: deps.ledger,
    // A trial is attended and judged on its own; a hold is refused before it starts.
    launch: { dataDir: paths.root, manager, launchCommand, folders, resources, held: () => false },
    lookups: () => lookups(paths.root),
    log: deps.log,
    now,
    changed,
  });
}
