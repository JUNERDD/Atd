import type { ComputerTargetKind } from '@atd/agent-contracts';
import type { RunScope } from './policy.js';

/*
 * Where the host may complete a step in the foreground
 * (docs/plans/2026-10-21-foreground-fallback.md R2, R8, R13). When no background route can do an
 * app's left `click`, `key`, `type` or in-window `drag` step, the host falls back to the foreground
 * within the same `act`: it brings the app forward, sends the step's clicks and keys straight to
 * it without ever moving the person's pointer, restores the app and window they had and reports
 * `delivery: 'foreground'`. Which steps it takes is the host's (`ComputerDelivery`); the model
 * neither asks for it nor chooses it. The service only tells the host, per request, whether it
 * may (`ExecutionEnvelope.foregroundAllowed`), and allows it for the person's own interactive work
 * alone: a free run (never a recipe-bound trial or grant run, so a foreground success can never
 * qualify a recipe), attended, from the run's root execution (never a child), on a native target
 * (never a website). Every other request, the service's own included (pending.ts), says no, so
 * its steps stay in the background.
 */

/** What decides it about the calling run. */
export interface ForegroundRun {
  scope: RunScope;
  unattended: boolean;
  executionId: string;
}

/**
 * Whether a request of `run` that acts on or describes the steps of targets of `kinds` lets the
 * host fall back to the foreground. A `targets` request over several bindings allows it when one
 * of them is native; the host still lists `foreground` only where a target has a foreground route,
 * which no website has.
 */
export function foregroundAllowed(
  run: ForegroundRun,
  kinds: readonly ComputerTargetKind[],
): boolean {
  return (
    run.scope.mode === 'free' &&
    !run.unattended &&
    run.executionId.startsWith('root:') &&
    kinds.includes('native')
  );
}
