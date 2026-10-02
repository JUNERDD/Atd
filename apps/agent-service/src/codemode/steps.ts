import {
  CODEMODE_MAX_STEPS,
  CODEMODE_STEP_OUTPUT_MAX_LENGTH,
  type CodemodeStepDetails,
} from '@atd/agent-contracts';
import { createClamp, isRecord } from '../transcript-details/clamp.js';
import type { StepList, StoredStep } from '../transcript-details/codemode.js';
import { projectToolDetails } from '../transcript-details/index.js';
import { contentText } from '../transcript.js';

/**
 * pi's per-call argument bound for its nested-call record
 * (`NESTED_CALL_LIMITS.maxArgumentBytesPerCall`); larger arguments are left out of a step too.
 */
const MAX_ARGS_BYTES = 8 * 1024;

/**
 * The calls `codemode` scripts make, grouped by the codemode call that made them. pi gives every
 * nested call the id `<codemode call id>/<n>` and reports its start and end with that parent id;
 * a step keeps what its row shows: the arguments, the result text and the projected details a
 * direct call's row would show. Two owners feed one: codemode/extension.ts from the `tool_call`
 * and `tool_result` hooks, to persist the steps in the codemode result, and live-transcript.ts
 * from the session's `tool_execution_*` events, to show them while the script runs.
 */
export class NestedStepLog {
  private readonly parents = new Map<string, StepList>();
  private readonly running = new Map<string, { step: StoredStep; list: StepList; at: number }>();

  start(parentId: string, id: string, name: string, args: unknown): void {
    let list = this.parents.get(parentId);
    if (!list) {
      list = { steps: [], truncated: false };
      this.parents.set(parentId, list);
    }
    if (list.steps.length >= CODEMODE_MAX_STEPS) {
      list.truncated = true;
      return;
    }
    const bounded = boundedArgs(args);
    if (!bounded) list.truncated = true;
    const step: StoredStep = { id, name, args: bounded ?? {}, status: 'running', output: '' };
    list.steps.push(step);
    this.running.set(id, { step, list, at: performance.now() });
  }

  /** Settles a started call with its result (`content` and `details` as pi reports them). */
  end(id: string, result: { content?: unknown; details?: unknown }, isError: boolean): void {
    const entry = this.running.get(id);
    if (!entry) return;
    this.running.delete(id);
    const { step, list } = entry;
    const clamp = createClamp();
    step.status = isError ? 'failed' : 'completed';
    step.durationMs = Math.round(performance.now() - entry.at);
    step.output = clamp.text(contentText(result.content), CODEMODE_STEP_OUTPUT_MAX_LENGTH);
    const details = isError ? undefined : stepDetails(step.name, result.details);
    if (details) step.details = details;
    if (clamp.truncated) list.truncated = true;
  }

  /** Every tracked codemode call's steps, by its call id. */
  get lists(): ReadonlyMap<string, StepList> {
    return this.parents;
  }

  /** Removes a codemode call's steps; calls still running are no longer tracked. */
  take(parentId: string): StepList | undefined {
    const list = this.parents.get(parentId);
    this.parents.delete(parentId);
    for (const step of list?.steps ?? []) this.running.delete(step.id);
    return list;
  }
}

/** A detached copy of the arguments, or undefined when they exceed the bound. */
function boundedArgs(args: unknown): Record<string, unknown> | undefined {
  if (!isRecord(args)) return {};
  const json = JSON.stringify(args);
  if (Buffer.byteLength(json) > MAX_ARGS_BYTES) return undefined;
  const copy: unknown = JSON.parse(json);
  return isRecord(copy) ? copy : {};
}

/** The details a direct call's row shows, for the tools a script can call that have any. */
function stepDetails(name: string, raw: unknown): CodemodeStepDetails | undefined {
  const details = projectToolDetails(name, raw);
  switch (details?.type) {
    case 'diff':
    case 'webSearch':
    case 'webFetch':
      return details;
    case 'codemode':
    case 'mcpApproval':
    case 'subagent':
    case 'todo':
    case undefined:
      return undefined;
  }
}
