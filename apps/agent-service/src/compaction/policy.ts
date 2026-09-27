import type { CompactionSettings } from '@earendil-works/pi-coding-agent';

/** The parts of a Pi model the policy reads; its window is the run's effective window. */
export interface PolicyModel {
  provider: string;
  id: string;
  contextWindow: number;
}

/**
 * The service's automatic compaction policy for one window `W` (plan D1/D4): Pi compacts once
 * context exceeds `W - reserveTokens`, about 85% on large windows, keeping Pi's 16,384-token
 * floor only while it stays below 30% of a small window; `keepRecentTokens` keeps Pi's 20,000
 * but never more than a quarter of the window. Users cannot tune it.
 */
export function compactionPolicy(window: number): {
  reserveTokens: number;
  keepRecentTokens: number;
} {
  return {
    reserveTokens: Math.max(Math.round(0.15 * window), Math.min(16384, Math.round(0.3 * window))),
    keepRecentTokens: Math.min(20000, Math.round(0.25 * window)),
  };
}

/**
 * Pi settings that apply the policy to one model: `compaction.modelOverrides["<provider>/<id>"]`.
 * Parent sessions pass it at creation and after a model change, and subagent children get it
 * from the trigger (subagents/trigger.ts), so a model compacts alike wherever it runs.
 */
export function compactionSettings(model: PolicyModel | undefined): {
  compaction: CompactionSettings;
} {
  if (!model || model.contextWindow <= 0) return { compaction: {} };
  return {
    compaction: {
      modelOverrides: { [`${model.provider}/${model.id}`]: compactionPolicy(model.contextWindow) },
    },
  };
}
