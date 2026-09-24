import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { TaskRun } from '@ai/agent-contracts';
import type { SessionFactoryDeps } from '../pi-session.js';
import type { RunBinding } from '../run-binding.js';
import type { Gate } from './gate.js';

/**
 * What a harness extension may use. pi-session.ts builds it once per Pi session and passes the
 * same object to every harness factory (harness/index.ts). A session outlives the run that built
 * it: read the current run through `runner.currentRunId()` / `runner.executionId()` when a tool
 * executes, never through `run`.
 */
export interface HarnessDeps {
  /**
   * Runner wiring shared by every session of the task: `ctx` (ledger, events, confirms,
   * capabilities, paths, log, default tier), `taskId`, `currentRunId`, `executionId`,
   * `currentMaterial`, session `grants`, `audit` and `setStatus`.
   */
  runner: SessionFactoryDeps;
  /** The run the session is built for; its snapshot fixed the binding (tools, memory, role). */
  run: TaskRun;
  binding: RunBinding;
  /** The task output directory: cwd and confinement root of the file tools. */
  cwd: string;
  /** The task's Pi session manager (custom entries, branch reads). */
  sessions: SessionManager;
  /** Tier, session-grant, confirm and audit decision for guarded calls (harness/gate.ts). */
  gate: Gate;
  /** Re-projects the live transcript after a custom entry changed what its blocks show. */
  reproject: () => void;
}
