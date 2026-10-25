import { mkdir, open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Compile } from 'typebox/compile';
import {
  COMPUTER_MAX_UNRESOLVED,
  ComputerFactSchema,
  isUnresolvedFact,
  type AutomationComputerFacts,
  type ComputerFact,
} from '@atd/agent-contracts';
import { currentFact } from './retired.js';

const FactValidator = Compile(ComputerFactSchema);

/** Run ids name record files; anything else in the directory is ignored. */
const RUN_FILE = /^([a-zA-Z0-9_-]{1,128})\.jsonl$/;

function recordsDir(dataDir: string): string {
  return path.join(dataDir, 'computer', 'records');
}

function runFile(dataDir: string, runId: string): string {
  return path.join(recordsDir(dataDir), `${runId}.jsonl`);
}

/**
 * Every valid fact line of a file, in order; a torn or foreign line is skipped. A line written
 * before computer protocol 8 reads as it would be written today (`currentFact`), so an action it
 * left unresolved is not skipped.
 */
function parseFacts(text: string): ComputerFact[] {
  const facts: ComputerFact[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = currentFact(JSON.parse(line));
    } catch {
      // A torn last line (the process died mid-append) records nothing.
      continue;
    }
    if (FactValidator.Check(value)) facts.push(value);
  }
  return facts;
}

/** The latest fact per action, in the order each action first appeared. */
function latestPerAction(facts: readonly ComputerFact[]): ComputerFact[] {
  const latest = new Map<string, ComputerFact>();
  for (const fact of facts) latest.set(fact.actionId, fact);
  return [...latest.values()];
}

/**
 * The durable computer facts of one run (`<dataDir>/computer/records/<runId>.jsonl`): the latest
 * fact per action id. A run without a record file acted on nothing.
 */
export async function readRunFacts(dataDir: string, runId: string): Promise<ComputerFact[]> {
  let text: string;
  try {
    text = await readFile(runFile(dataDir, runId), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return latestPerAction(parseFacts(text));
}

/**
 * A run's facts as its automation run record counts them: settled `verified`, `partial` and
 * `unknown` effects (an unresolved fact without a result counts as `unknown`), actions never
 * dispatched, and the actions still unresolved (`isUnresolvedFact`). A read-only action whose
 * postcondition held is `verified` although it dispatched nothing.
 */
export function summarizeFacts(facts: readonly ComputerFact[]): AutomationComputerFacts {
  const counts = { verified: 0, partial: 0, unknown: 0, notDispatched: 0 };
  const unresolved: string[] = [];
  for (const fact of latestPerAction(facts)) {
    if (isUnresolvedFact(fact)) unresolved.push(fact.actionId);
    const result = fact.result;
    if (!result) {
      if (isUnresolvedFact(fact)) counts.unknown += 1;
    } else if (result.effect === 'verified') counts.verified += 1;
    else if (result.dispatch === 'not_dispatched') counts.notDispatched += 1;
    else if (result.effect === 'partial') counts.partial += 1;
    else if (result.effect === 'unknown') counts.unknown += 1;
  }
  return { facts: counts, unresolvedActionIds: unresolved.slice(0, COMPUTER_MAX_UNRESOLVED) };
}

/**
 * The service's authoritative action journal. A fact is appended and fsynced before the action is
 * sent (its intent) and again when its result arrives, so a crash between the two leaves an
 * unresolved fact rather than no fact. Facts live outside the task folder and are never removed
 * with a task: only a record with a `resolution` (resolve.ts) ends what an unresolved one left
 * open. In memory it keeps the latest fact of every action this process appended plus every
 * unresolved fact found at load, so repeated action ids, host reconnects and the unresolved gate
 * are answered without reading every file; a resolved fact drops out of `unresolved()`.
 */
export class ComputerRecords {
  private readonly latest = new Map<string, ComputerFact>();
  private readonly chains = new Map<string, Promise<void>>();

  private constructor(readonly dataDir: string) {}

  /** Loads the unresolved facts of every run, which a reconnecting host is asked about. */
  static async load(dataDir: string): Promise<ComputerRecords> {
    const records = new ComputerRecords(dataDir);
    let names: string[];
    try {
      names = await readdir(recordsDir(dataDir));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return records;
      throw error;
    }
    for (const name of names) {
      const runId = RUN_FILE.exec(name)?.[1];
      if (!runId) continue;
      for (const fact of await readRunFacts(dataDir, runId))
        if (isUnresolvedFact(fact)) records.latest.set(fact.actionId, fact);
    }
    return records;
  }

  /** The latest known fact of an action, of any run. */
  find(actionId: string): ComputerFact | undefined {
    return this.latest.get(actionId);
  }

  /** The unresolved facts known to this process, oldest first. */
  unresolved(): ComputerFact[] {
    return [...this.latest.values()].filter(isUnresolvedFact);
  }

  /** Appends one fact to its run's file and fsyncs it before resolving; appends are serialized. */
  append(fact: ComputerFact): Promise<void> {
    // A fact that would not read back must fail the action before it is sent.
    if (!FactValidator.Check(fact)) return Promise.reject(new TypeError('Invalid computer fact.'));
    const previous = this.chains.get(fact.runId) ?? Promise.resolve();
    const next = previous.then(() => this.write(fact));
    this.chains.set(
      fact.runId,
      next.catch(() => undefined),
    );
    return next;
  }

  private async write(fact: ComputerFact): Promise<void> {
    await mkdir(recordsDir(this.dataDir), { recursive: true, mode: 0o700 });
    const handle = await open(runFile(this.dataDir, fact.runId), 'a', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(fact)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.latest.set(fact.actionId, fact);
  }
}
