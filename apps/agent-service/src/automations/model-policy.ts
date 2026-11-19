import {
  findModelAlias,
  resolveAliasDefaults,
  type AutomationDraft,
  type ModelSelection,
  type RunContextChoice,
  type ServiceCommandFull,
  type ThinkingLevel,
} from '@atd/agent-contracts';
import { ConnectionStore } from '../credentials/connections.js';
import type { Lookups } from './checks.js';

export interface ResolvedAutomationPolicy {
  model?: ModelSelection;
  contextChoice?: RunContextChoice;
  thinkingLevel?: ThinkingLevel;
  missingAlias?: boolean;
}

/**
 * Checks whether an automation's effective model (policy alias, policy model, command fixed/alias,
 * or global fallback) currently resolves to a connected provider or temporary credentials.
 */
export async function policyModelAvailable(
  automation: AutomationDraft,
  command: ServiceCommandFull | null,
  lookups: Pick<Lookups, 'modelAvailable' | 'aliasAvailable'>,
): Promise<boolean> {
  if (automation.policy.aliasId) return lookups.aliasAvailable(automation.policy.aliasId);
  if (automation.policy.model) return lookups.modelAvailable(automation.policy.model);
  if (automation.action.kind === 'command' && command?.model.mode === 'alias') {
    return lookups.aliasAvailable(command.model.aliasId);
  }
  if (automation.action.kind === 'command' && command?.model.mode === 'fixed') {
    return lookups.modelAvailable({
      connectionId: command.model.connectionId,
      modelId: command.model.modelId,
    });
  }
  return lookups.modelAvailable(undefined);
}

/**
 * Resolves an automation's live model, context window choice, and thinking level against the
 * current `ConnectionStore` right before firing, trial execution, or memory consolidation.
 */
export async function resolveAutomationPolicy(
  dataDir: string,
  policy: AutomationDraft['policy'],
  options: { includeDefaultAlias?: boolean } = {},
): Promise<ResolvedAutomationPolicy> {
  if (policy.model && policy.aliasId) {
    throw new TypeError('An automation policy cannot set both a model and a model alias.');
  }
  if (policy.model) {
    return {
      model: policy.model,
      ...(policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
    };
  }
  if (policy.aliasId) {
    const store = await ConnectionStore.load(dataDir);
    const alias = findModelAlias(store.data.aliases, policy.aliasId);
    if (!alias) return { missingAlias: true };
    const defaults = resolveAliasDefaults(alias);
    const thinkingLevel = policy.thinkingLevel ?? defaults.thinkingLevel;
    return {
      ...(defaults.model ? { model: defaults.model } : {}),
      ...(defaults.contextChoice ? { contextChoice: defaults.contextChoice } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
  }
  if (options.includeDefaultAlias) {
    const store = await ConnectionStore.load(dataDir);
    const defaultId = store.data.defaultAliasId ?? undefined;
    const alias = findModelAlias(store.data.aliases, defaultId);
    const usable =
      alias &&
      store.data.connections.some(
        (item) => item.connectionId === alias.connectionId && item.connected,
      );
    if (usable) {
      const defaults = resolveAliasDefaults(alias);
      const thinkingLevel = policy.thinkingLevel ?? defaults.thinkingLevel;
      return {
        ...(defaults.model ? { model: defaults.model } : {}),
        ...(defaults.contextChoice ? { contextChoice: defaults.contextChoice } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      };
    }
  }
  return policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {};
}
