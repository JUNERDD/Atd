import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  AutomationComputerPolicySchema,
  ComputerHashSchema,
  ComputerRunTrialSchema,
  ComputerTrialSchema,
  Identifier,
  type ComputerBindingHashes,
  type ComputerFact,
  type ComputerTrial,
  type ComputerTrialState,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import { ConflictError } from '../errors.js';
import { sameBindingHashes } from './computer-grant.js';
import { trialPassed } from './computer-outcome.js';

/**
 * The attended trials of automations' recipes (`<dataDir>/computer/trials.json`, a protected
 * write root): the trials still running, with the scope they froze, and the outcomes recorded
 * from host-verified facts when they ended. A grant may cite only a passed trial whose hashes
 * match what is approved. A file of another version or a damaged one is never overwritten: no
 * trial it holds counts and nothing new is recorded until it is dealt with (`problem`).
 */

const MAX_TRIALS = 500;
const MAX_PENDING = 100;
/** Outcomes kept per automation, newest first. */
const TRIALS_PER_AUTOMATION = 5;

const PendingTrialSchema = Type.Object(
  {
    trial: ComputerRunTrialSchema,
    engineProfilesHash: ComputerHashSchema,
    /** The computer scope the trial ran, which its facts are judged against. */
    policy: AutomationComputerPolicySchema,
    taskId: Identifier,
    runId: Identifier,
    startedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type PendingTrial = Static<typeof PendingTrialSchema>;

const TrialsFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    trials: Type.Array(ComputerTrialSchema, { maxItems: MAX_TRIALS }),
    pending: Type.Array(PendingTrialSchema, { maxItems: MAX_PENDING }),
  },
  { additionalProperties: false },
);
type TrialsFile = Static<typeof TrialsFileSchema>;

/**
 * How the file loaded: `ok`, `absent` (no file yet), `incompatible` (another version) or `corrupt`
 * (unreadable or not matching its version). Only `ok` and `absent` may be written.
 */
export type TrialsLoad = 'ok' | 'absent' | 'incompatible' | 'corrupt';

/** Reads the stored file and judges it, without changing anything. */
async function readTrials(file: string): Promise<{ load: TrialsLoad; data?: TrialsFile }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    const absent = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    return { load: absent ? 'absent' : 'corrupt' };
  }
  if (Value.Check(TrialsFileSchema, raw)) return { load: 'ok', data: raw };
  const version =
    typeof raw === 'object' && raw !== null && 'version' in raw ? raw.version : undefined;
  return { load: typeof version === 'number' && version !== 1 ? 'incompatible' : 'corrupt' };
}

export function trialsFile(dataDir: string): string {
  return path.join(dataDir, 'computer', 'trials.json');
}

/** The hashes a trial must match to qualify a grant. */
export interface TrialScope {
  automationId: string;
  definitionHash: string;
  recipeHash: string;
  bindingHashes: ComputerBindingHashes;
  engineProfilesHash: string;
}

export class ComputerTrials {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private current: TrialsFile,
    /** How the file loaded; only `ok` and `absent` may be written. */
    readonly outcome: TrialsLoad,
  ) {}

  static async load(dataDir: string): Promise<ComputerTrials> {
    const file = trialsFile(dataDir);
    const read = await readTrials(file);
    return new ComputerTrials(
      file,
      read.data ?? { version: 1, trials: [], pending: [] },
      read.load,
    );
  }

  /** Why no trial can be recorded, or null when the file can be written. */
  get problem(): string | null {
    switch (this.outcome) {
      case 'ok':
      case 'absent':
        return null;
      case 'incompatible':
        return 'The computer trials file is from another version of Atd; trials cannot be recorded.';
      case 'corrupt':
        return 'The computer trials file is damaged; trials cannot be recorded.';
    }
  }

  get pending(): readonly PendingTrial[] {
    return this.current.pending;
  }

  /** The newest passed trial matching `scope` exactly, or null. */
  matching(scope: TrialScope): ComputerTrial | null {
    return (
      this.current.trials.find(
        (trial) =>
          trial.result === 'passed' &&
          trial.automationId === scope.automationId &&
          trial.definitionHash === scope.definitionHash &&
          trial.recipeHash === scope.recipeHash &&
          trial.engineProfilesHash === scope.engineProfilesHash &&
          sameBindingHashes(trial.bindingHashes, scope.bindingHashes),
      ) ?? null
    );
  }

  /**
   * Where the newest trial of exactly this definition and recipe stands, or undefined when none
   * ran. Bindings and engines are compared when the trial is used for a grant (`matching`).
   */
  state(
    automationId: string,
    definitionHash: string,
    recipeHash: string,
  ): ComputerTrialState | undefined {
    const same = (trial: Pick<ComputerTrial, 'automationId' | 'definitionHash' | 'recipeHash'>) =>
      trial.automationId === automationId &&
      trial.definitionHash === definitionHash &&
      trial.recipeHash === recipeHash;
    if (this.current.pending.some((item) => same(item.trial))) return 'running';
    return this.current.trials.find(same)?.result;
  }

  running(automationId: string): boolean {
    return this.current.pending.some((item) => item.trial.automationId === automationId);
  }

  /** Records a trial that started; it is judged when its run ends (`finish`). */
  begin(pending: PendingTrial): Promise<void> {
    return this.change((data) => {
      if (data.pending.length >= MAX_PENDING) throw new Error('Too many trials are running.');
      data.pending.push(pending);
    });
  }

  /**
   * Judges the trial run `runId` from its facts and records the outcome; answers it, or null when
   * no trial waits on that run.
   */
  finish(runId: string, facts: readonly ComputerFact[], at: string): Promise<ComputerTrial | null> {
    return this.change((data) => {
      const pending = data.pending.find((item) => item.runId === runId);
      if (!pending) return null;
      data.pending = data.pending.filter((item) => item !== pending);
      const recorded: ComputerTrial = {
        ...pending.trial,
        engineProfilesHash: pending.engineProfilesHash,
        result: trialPassed(facts, pending.policy) ? 'passed' : 'failed',
        runId,
        at,
      };
      const own = data.trials.filter((item) => item.automationId === pending.trial.automationId);
      const kept = new Set([recorded, ...own].slice(0, TRIALS_PER_AUTOMATION));
      data.trials = [recorded, ...data.trials]
        .filter((item) => item.automationId !== pending.trial.automationId || kept.has(item))
        .slice(0, MAX_TRIALS);
      return recorded;
    });
  }

  /** Drops everything recorded for a deleted automation; an unwritable file is left as it is. */
  forget(automationId: string): Promise<void> {
    if (this.problem) return Promise.resolve();
    return this.change((data) => {
      data.trials = data.trials.filter((item) => item.automationId !== automationId);
      data.pending = data.pending.filter((item) => item.trial.automationId !== automationId);
    });
  }

  private change<T>(update: (draft: TrialsFile) => T): Promise<T> {
    const operation = this.chain.then(async () => {
      const { problem } = this;
      if (problem) throw new ConflictError(problem);
      const draft = structuredClone(this.current);
      const result = update(draft);
      if (JSON.stringify(draft) === JSON.stringify(this.current)) return result;
      await atomicWrite(this.file, draft);
      this.current = draft;
      return result;
    });
    this.chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
