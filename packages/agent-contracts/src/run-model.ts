import type { CommandThinkingLevel } from './command-run.js';
import type { ModelAlias, RunContextChoice } from './model-aliases.js';
import type { ServiceModelDefinition, ThinkingLevel } from './models.js';
import type { ModelSelection } from './task.js';

/** A command's model policy, as the service and the renderer both store it. */
export type CommandModelPolicy =
  | { mode: 'inherit' }
  | { mode: 'fixed'; connectionId: string; modelId: string }
  | { mode: 'alias'; aliasId: string };

/** Looks up a saved model alias by id; returns undefined when absent or id is omitted. */
export function findModelAlias(
  aliases: readonly ModelAlias[] | undefined,
  aliasId: string | undefined,
): ModelAlias | undefined {
  if (!aliasId || !aliases?.length) return undefined;
  return aliases.find((alias) => alias.id === aliasId);
}

/** Extracts the run selection and slot defaults carried by a saved model alias. */
export function resolveAliasDefaults(alias: ModelAlias | undefined): {
  model?: ModelSelection;
  contextChoice?: RunContextChoice;
  thinkingLevel?: ThinkingLevel;
} {
  if (!alias) return {};
  return {
    model: { connectionId: alias.connectionId, modelId: alias.modelId },
    ...(alias.contextChoice ? { contextChoice: alias.contextChoice } : {}),
    ...(alias.thinkingLevel ? { thinkingLevel: alias.thinkingLevel } : {}),
  };
}

/** Where a run's model can come from, strongest first. */
export interface RunModelSources {
  /** The model picked for this run. */
  requested?: ModelSelection | null;
  /** The model policy of the command the run starts from. */
  command?: CommandModelPolicy | null;
  /** The model of the task's last run, which a follow-up keeps. */
  last?: ModelSelection | null;
  /** Saved model aliases for resolving alias commands and the default alias fallback. */
  aliases?: readonly ModelAlias[];
  /** Default alias id consulted when no explicit selection or last-run model applies. */
  defaultAliasId?: string | null;
  /**
   * Whether a connection is still saved. A last run on a removed connection, or on the operator's
   * temporary credentials, is not carried over.
   */
  hasConnection: (connectionId: string) => boolean;
  /**
   * Whether a connection is currently connected/usable for fallback default alias resolution.
   * Defaults to `hasConnection` when omitted.
   */
  isConnectionUsable?: (connectionId: string) => boolean;
}

/**
 * The model a run asks for:
 * 1. the one picked for it (`requested`),
 * 2. the command's fixed model or resolved alias,
 * 3. the model of the task's last run while its connection is still saved,
 * 4. the default alias when its connection is connected/usable,
 * 5. undefined (leaving the default connection's default model).
 */
export function runModelSelection(sources: RunModelSources): ModelSelection | undefined {
  const { requested, command, last, aliases, defaultAliasId } = sources;
  if (requested) return { connectionId: requested.connectionId, modelId: requested.modelId };
  if (command?.mode === 'fixed')
    return { connectionId: command.connectionId, modelId: command.modelId };
  if (command?.mode === 'alias') {
    const alias = findModelAlias(aliases, command.aliasId);
    if (alias) return { connectionId: alias.connectionId, modelId: alias.modelId };
  }
  if (last && sources.hasConnection(last.connectionId))
    return { connectionId: last.connectionId, modelId: last.modelId };
  if (defaultAliasId) {
    const alias = findModelAlias(aliases, defaultAliasId);
    const usable = sources.isConnectionUsable ?? sources.hasConnection;
    if (alias && usable(alias.connectionId))
      return { connectionId: alias.connectionId, modelId: alias.modelId };
  }
  return undefined;
}

/**
 * The reasoning level a command run asks for: the level picked for the run, else the command's own
 * unless it is `inherit`. Undefined leaves the connection's default level. The service previews
 * and freezes command runs through this; the run clamps the level to what its model supports.
 */
export function commandThinkingLevel(
  requested: ThinkingLevel | undefined,
  command: CommandThinkingLevel | undefined,
): ThinkingLevel | undefined {
  if (requested) return requested;
  return command === 'inherit' ? undefined : command;
}

/** Canonical thinking levels ordered from lowest to highest effort. */
export const THINKING_LEVEL_ORDER: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Returns the ordered thinking levels supported by a catalog model definition. */
export function supportedModelThinkingLevels(
  definition: Pick<ServiceModelDefinition, 'reasoning' | 'thinkingLevelMap'>,
): ThinkingLevel[] {
  if (!definition.reasoning) return ['off'];
  return THINKING_LEVEL_ORDER.filter((level) => {
    const mapped = definition.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
}

/** Clamps a thinking level to the nearest level supported by the model, preferring higher effort. */
export function clampSupportedThinkingLevel(
  levels: readonly ThinkingLevel[],
  level: ThinkingLevel,
): ThinkingLevel {
  if (levels.length === 0 || levels.includes(level)) return level;
  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level);
  if (requestedIndex === -1) return levels[0] ?? 'off';
  for (let i = requestedIndex; i < THINKING_LEVEL_ORDER.length; i++) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (candidate !== undefined && levels.includes(candidate)) return candidate;
  }
  for (let i = requestedIndex - 1; i >= 0; i--) {
    const candidate = THINKING_LEVEL_ORDER[i];
    if (candidate !== undefined && levels.includes(candidate)) return candidate;
  }
  return levels[0] ?? 'off';
}

/** Resolves a catalog model's default thinking level clamped to what the model supports. */
export function catalogModelDefaultThinkingLevel(
  definition: Pick<
    ServiceModelDefinition,
    'reasoning' | 'thinkingLevelMap' | 'defaultThinkingLevel'
  >,
): ThinkingLevel {
  return clampSupportedThinkingLevel(
    supportedModelThinkingLevels(definition),
    definition.defaultThinkingLevel ?? 'medium',
  );
}

/** Resolves the effective thinking level across explicit, connection, and model defaults. */
export function resolveEffectiveThinkingLevel(
  explicitLevel: ThinkingLevel | undefined,
  connectionDefault: ThinkingLevel | undefined,
  levels: readonly ThinkingLevel[],
  modelDefault?: ThinkingLevel,
): ThinkingLevel | undefined {
  const raw = explicitLevel ?? connectionDefault ?? modelDefault;
  return raw ? clampSupportedThinkingLevel(levels, raw) : undefined;
}
