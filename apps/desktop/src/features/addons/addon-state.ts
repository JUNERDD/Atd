import type { AddonErrorCode, AddonView } from '@atd/agent-contracts';

/**
 * Where an add-on stands for the person, in the order the card checks it:
 * - `loading`: the list is not read yet (or this build does not know the id);
 * - `unavailable`: this build ships no archive for this Mac;
 * - `working`: the service is downloading, verifying, installing or removing it;
 * - `outdated`: an older archive is installed and never active, so it needs an update;
 * - `installed` / `notInstalled`: the settled states.
 */
export type AddonState =
  | 'loading'
  | 'unavailable'
  | 'working'
  | 'outdated'
  | 'installed'
  | 'notInstalled';

export function addonState(addon: AddonView | null): AddonState {
  if (!addon) return 'loading';
  if (!addon.available) return 'unavailable';
  if (addon.phase !== 'idle') return 'working';
  if (addon.installed) return 'installed';
  return addon.outdated ? 'outdated' : 'notInstalled';
}

/**
 * The last failure worth showing. A cancelled install is the person's own doing, not a failure,
 * and a settled state that is not working shows nothing else.
 */
export function addonFailure(
  addon: AddonView | null,
): { code: AddonErrorCode; message: string } | null {
  if (!addon?.error || addon.phase !== 'idle' || addon.error.code === 'cancelled') return null;
  return addon.error;
}

/** Download progress as a whole percent, or null when the total is not known. */
export function progressPercent(addon: AddonView): number | null {
  const progress = addon.progress;
  if (!progress || progress.total <= 0) return null;
  return Math.min(100, Math.round((progress.received / progress.total) * 100));
}
