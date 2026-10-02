import type { ModelSelection } from './task.js';

/** A command's model policy, as the service and the renderer both store it. */
export type CommandModelPolicy =
  | { mode: 'inherit' }
  | { mode: 'fixed'; connectionId: string; modelId: string };

/** Where a run's model can come from, strongest first. */
export interface RunModelSources {
  /** The model picked for this run. */
  requested?: ModelSelection | null;
  /** The model policy of the command the run starts from. */
  command?: CommandModelPolicy | null;
  /** The model of the task's last run, which a follow-up keeps. */
  last?: ModelSelection | null;
  /**
   * Whether a connection is still saved. A last run on a removed connection, or on the operator's
   * temporary credentials, is not carried over.
   */
  hasConnection: (connectionId: string) => boolean;
}

/**
 * The model a run asks for: the one picked for it, else the command's fixed model, else the model
 * of the task's last run while its connection is still saved. Undefined leaves the default
 * connection's default model. The service previews and freezes runs through this, and the panel's
 * model picker shows the same choice, so a run uses the model the picker displays.
 */
export function runModelSelection(sources: RunModelSources): ModelSelection | undefined {
  const { requested, command, last } = sources;
  if (requested) return { connectionId: requested.connectionId, modelId: requested.modelId };
  if (command?.mode === 'fixed')
    return { connectionId: command.connectionId, modelId: command.modelId };
  if (last && sources.hasConnection(last.connectionId))
    return { connectionId: last.connectionId, modelId: last.modelId };
  return undefined;
}
