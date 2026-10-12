import type { AppBuildDetails, ProductArtifact } from '@atd/agent-contracts';
import { openCommandSettings } from '../../commands/open-command-settings';
import { showErrorToast } from '../../../components/toast-store';
import type { SettingsItemLink } from '../../../client/settings-contract';
import type { ViewBlock } from './adapter';

/** One card at a turn's end: the item, and for an app the build its card shows. */
export interface TurnArtifact {
  artifact: ProductArtifact;
  /** The turn's last build of the app (`app` details), which the app's own card renders. */
  app: AppBuildDetails | null;
}

/**
 * The product items these steps created or changed, one per item in the order the turn first
 * saved each. A later save of the same item brings its newest name and build, but an item the
 * turn created stays created: to the user it is new either way.
 */
export function turnArtifactsIn(steps: readonly ViewBlock[]): TurnArtifact[] {
  const byItem = new Map<string, TurnArtifact>();
  for (const { source } of steps) {
    if (source.kind !== 'tool' || !source.details.artifact) continue;
    const artifact = source.details.artifact;
    const data = source.details.data;
    const key = `${artifact.kind}:${artifact.id}`;
    const earlier = byItem.get(key);
    const action = earlier?.artifact.action === 'created' ? 'created' : artifact.action;
    byItem.set(key, {
      artifact: { ...artifact, action },
      app: data?.type === 'app' ? data : (earlier?.app ?? null),
    });
  }
  return [...byItem.values()];
}

/** Where Settings shows an item; commands open through their own link and apps on their own. */
function settingsLink(artifact: ProductArtifact): SettingsItemLink | null {
  const { kind, id, name } = artifact;
  switch (kind) {
    case 'memory':
      return { section: 'memory', id };
    case 'automation':
      return { section: 'automations', id };
    case 'skill':
      return { section: 'extensions', kind: 'skill', name };
    case 'subagent':
      return { section: 'extensions', kind: 'agent', name };
    case 'mcp':
      return { section: 'extensions', kind: 'mcp', name: id };
    case 'command':
    case 'app':
      return null;
  }
}

/**
 * Opens a saved item where the user manages it: a command's editor, or the item's page in
 * Settings. An app opens through its own card's actions instead. A failure reads as a toast, as
 * the command link reports it.
 */
export async function openArtifact(artifact: ProductArtifact): Promise<void> {
  if (artifact.kind === 'command') return openCommandSettings(artifact.id);
  const link = settingsLink(artifact);
  if (!link) return;
  try {
    await window.desktop?.settings.openItem(link);
  } catch (error) {
    showErrorToast(error);
  }
}
