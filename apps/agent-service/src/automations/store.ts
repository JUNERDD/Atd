import { readFile, rename, stat } from 'node:fs/promises';
import type { TSchema, Static } from 'typebox';
import { Value } from 'typebox/value';
import { parse } from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import {
  AutomationsFileSchema,
  AutomationStateFileSchema,
  definitionsFile,
  emptyDefinitions,
  emptyState,
  stateFile,
  type AutomationsFile,
  type AutomationStateFile,
} from './files.js';

/** Larger files are not read; the record bounds keep both files far below it. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface AutomationData {
  definitions: AutomationsFile;
  state: AutomationStateFile;
}

type FileKey = 'definitions' | 'state';

interface Loaded<T> {
  value: T;
  problem?: string;
}

/**
 * The automations store (decision D9): `automations.json` and `state.json` in memory, changed
 * through one serialized chain of atomic writes, each validated before it is written. Loading
 * never fails: a file that cannot be read or comes from a newer version leaves the store with a
 * `problem` (the engine stays inert and the list route reports it) and an empty stand-in; the next
 * change moves the file aside as `<file>.invalid-<ms>` instead of overwriting it in place.
 */
export class AutomationStore {
  private chain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  private constructor(
    private readonly dataDir: string,
    private current: AutomationData,
    private readonly broken: Map<FileKey, string>,
  ) {}

  static async load(dataDir: string): Promise<AutomationStore> {
    const definitions = await readJson(
      definitionsFile(dataDir),
      AutomationsFileSchema,
      emptyDefinitions,
      'The saved automations',
    );
    const state = await readJson(
      stateFile(dataDir),
      AutomationStateFileSchema,
      emptyState,
      'The automation run history',
    );
    const broken = new Map<FileKey, string>();
    if (definitions.problem) broken.set('definitions', definitions.problem);
    if (state.problem) broken.set('state', state.problem);
    return new AutomationStore(
      dataDir,
      { definitions: definitions.value, state: state.value },
      broken,
    );
  }

  /** The current files. Callers treat them as read-only and change them through `change`. */
  get data(): AutomationData {
    return this.current;
  }

  /** Why nothing fires: a file could not be read. The next change moves it aside and clears it. */
  get problem(): string | undefined {
    if (!this.broken.size) return undefined;
    const reasons = [...this.broken.values()].join(' ');
    return `${reasons} Nothing fires until the next change, which keeps the file aside as *.invalid-<time>.`.slice(
      0,
      2000,
    );
  }

  /**
   * Applies `update` to a copy of both files and writes each one that changed (a definitions
   * write bumps the file revision) or could not be read, which is moved aside first. A change
   * that changes nothing writes nothing and tells no listener. Listeners run after the writes
   * landed; a failed write changes nothing in memory.
   */
  change<T>(update: (draft: AutomationData) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => {
      const draft = structuredClone(this.current);
      const result = await update(draft);
      const writeDefinitions =
        this.broken.has('definitions') ||
        JSON.stringify(draft.definitions) !== JSON.stringify(this.current.definitions);
      const writeState =
        this.broken.has('state') ||
        JSON.stringify(draft.state) !== JSON.stringify(this.current.state);
      if (!writeDefinitions && !writeState) return result;
      if (writeDefinitions) draft.definitions.revision = this.current.definitions.revision + 1;
      const definitions = parse(AutomationsFileSchema, draft.definitions);
      const state = parse(AutomationStateFileSchema, draft.state);
      await this.moveAside();
      if (writeDefinitions) await atomicWrite(definitionsFile(this.dataDir), definitions);
      if (writeState) await atomicWrite(stateFile(this.dataDir), state);
      this.current = draft;
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          // A broken listener must not fail a change that already landed.
        }
      }
      return result;
    });
    this.chain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /** Runs `listener` after each change landed; answers the unsubscribe. */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resolves once every change queued so far has settled. */
  idle(): Promise<void> {
    return this.chain;
  }

  private async moveAside(): Promise<void> {
    const stamp = Date.now();
    for (const key of this.broken.keys()) {
      const file = key === 'definitions' ? definitionsFile(this.dataDir) : stateFile(this.dataDir);
      await rename(file, `${file}.invalid-${stamp}`).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
    this.broken.clear();
  }
}

async function readJson<T extends TSchema>(
  file: string,
  schema: T,
  empty: () => Static<T>,
  label: string,
): Promise<Loaded<Static<T>>> {
  let raw: unknown;
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES)
      return { value: empty(), problem: `${label} file is too large to read.` };
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (isMissing(error)) return { value: empty() };
    return { value: empty(), problem: `${label} file could not be read.` };
  }
  if (Value.Check(schema, raw)) return { value: raw };
  return { value: empty(), problem: `${label} file is damaged or from a newer version.` };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
