import { THINKING_LEVELS } from './task-agent-definition.js';

/**
 * The model and thinking a child must launch with. Children run on their parent run's model at
 * the thinking level the session registered for their agent: `off` for the service and catalog
 * agents, the recorded level for a task agent. pi-subagents also applies `subagents` settings
 * (`defaultModel`, `defaultThinking` and each agent's `agentOverrides` model, thinking and fast
 * mode) from a `.pi/settings.json` it finds in the parent's cwd or a folder above it, without a
 * trust check. That cwd is the task folder, which the parent and its children can write, so the
 * launch trigger checks every child launch against the values the service owns and refuses one
 * those settings changed (trigger.ts).
 */

/**
 * The model reference pi-subagents writes on a child launch (`ChildSessionLaunch.model`) for a
 * child on `model` at `thinking`: `provider/model`, then `:thinking` unless the model id already
 * ends in a thinking level (its `applyThinkingSuffix`, which then keeps that suffix).
 */
export function launchModelReference(
  model: { provider: string; modelId: string },
  thinking: string,
): string {
  const reference = `${model.provider}/${model.modelId}`;
  const suffix = reference.slice(reference.lastIndexOf(':') + 1);
  return reference.includes(':') && THINKING_LEVELS.some((level) => level === suffix)
    ? reference
    : `${reference}:${thinking}`;
}

/** What the launch trigger reads of a child launch to check its model. */
export interface LaunchModelFields {
  /** `provider/model`, optionally `:thinking`; pi-subagents resolves the child's model from it. */
  model?: string;
  runtime?: { fast?: boolean };
}

const SETTINGS =
  'pi-subagents settings (a .pi/settings.json in the task folder or a folder above it)';

/**
 * Why a child launch cannot run with the model and thinking it carries, or null when they are the
 * ones the service registered (`expected`, from `launchModelReference`; null when the session
 * registered no such agent).
 */
export function launchModelProblem(
  launch: LaunchModelFields,
  expected: string | null,
): string | null {
  if (expected === null)
    return 'The subagent child has no model its parent registered; refusing to start.';
  if (launch.model !== expected)
    return `${SETTINGS} changed this child's model or thinking: it would run on ${launch.model ?? 'no model'} instead of ${expected}. Remove those settings; refusing to start.`;
  if (launch.runtime?.fast === true)
    return `${SETTINGS} turned on fast mode for this child. Remove those settings; refusing to start.`;
  return null;
}
