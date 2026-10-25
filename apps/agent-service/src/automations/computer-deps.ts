import type {
  AutomationComputerFacts,
  CapabilityProfile,
  ComputerCancelReason,
  ComputerEngine,
  ComputerFact,
  TargetBinding,
} from '@atd/agent-contracts';
import { readRunFacts, summarizeFacts } from '../computer/records.js';
import type { ComputerRuntime } from '../computer/runtime.js';

/**
 * What automations need from the service's computer module (decision D11), injected through the
 * automation deps bag; `automationComputer` adapts the service's `ComputerRuntime` and is the
 * only place this directory reaches into that module. A service built without it has no computer
 * use, so every automation that requests a computer scope is refused at save and never fires.
 */

/** The registered targets (`ComputerBindingStore` satisfies it structurally). */
export interface ComputerBindingSource {
  get(bindingId: string): TargetBinding | undefined;
  list(): TargetBinding[];
  /**
   * Calls `listener` with the binding id after a binding's content changed or it was deleted; the
   * automation ids a listener answers are the ones whose grant it invalidated.
   */
  onChange(listener: (bindingId: string) => void | Promise<readonly string[] | void>): () => void;
}

export interface AutomationComputer {
  bindings: ComputerBindingSource;
  /** What the bound host published in `computer.hello`; empty while no host is bound. */
  profiles(): readonly CapabilityProfile[];
  /**
   * The ids of the add-ons providing `engines` that are not installed, in engine order; a built-in
   * engine (`atd`, for apps) never names one.
   */
  missingAddons(engines: readonly ComputerEngine[]): string[];
  /** The latest fact per action of one task run (`records.ts` `readRunFacts` bound to dataDir). */
  readRunFacts(runId: string): Promise<ComputerFact[]>;
  /** `records.ts` `summarizeFacts`: the counts a run record keeps. */
  summarizeFacts(facts: readonly ComputerFact[]): AutomationComputerFacts;
  /** Closes the run's computer work at once: no new step starts, pending ones are cancelled. */
  cancelRun(taskId: string, runId: string, reason: ComputerCancelReason): void | Promise<void>;
}

/** The automations' view of the service's computer runtime. */
export function automationComputer(runtime: ComputerRuntime): AutomationComputer {
  return {
    bindings: runtime.bindings,
    profiles: () => runtime.coordinator.hostStatus().profiles,
    missingAddons: (engines) => engines.flatMap((engine) => runtime.missingAddon(engine) ?? []),
    readRunFacts: (runId) => readRunFacts(runtime.dataDir, runId),
    summarizeFacts,
    cancelRun: (taskId, runId, reason) => runtime.cancelRun(taskId, runId, reason),
  };
}
