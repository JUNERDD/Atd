import {
  createModelAlias,
  removeModelAlias,
  setDefaultModelAlias,
  updateModelAlias,
  type AgentClientOptions,
} from '@atd/agent-client';
import type { ModelAlias, ModelAliasDraft } from '@atd/agent-contracts';

/** Creates a model alias on the service and returns the saved alias. */
export async function createLiveAlias(
  options: AgentClientOptions,
  draft: ModelAliasDraft,
): Promise<ModelAlias> {
  return (await createModelAlias(options, draft)).alias;
}

/** Replaces a saved model alias and returns the updated record. */
export async function updateLiveAlias(
  options: AgentClientOptions,
  aliasId: string,
  draft: ModelAliasDraft,
): Promise<ModelAlias> {
  return (await updateModelAlias(options, aliasId, draft)).alias;
}

/** Deletes a saved model alias. */
export async function removeLiveAlias(options: AgentClientOptions, aliasId: string): Promise<void> {
  await removeModelAlias(options, aliasId);
}

/** Sets or clears the service's default model alias. */
export async function setDefaultLiveAlias(
  options: AgentClientOptions,
  defaultAliasId: string | null,
): Promise<void> {
  await setDefaultModelAlias(options, defaultAliasId);
}
