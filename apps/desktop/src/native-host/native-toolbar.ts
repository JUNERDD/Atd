import type { SelectionToolbarSettings } from '@atd/agent-contracts';
import type { CommandDefinition } from '../client/agent/command-schema';
import type { CallParams, NativeBridge } from '../native-bridge/client';

/** Commands `toolbar.set` takes; the shell folds those past its width into More. */
const MAX_TOOLBAR_COMMANDS = 64;

/**
 * What the selection toolbar offers: whether it shows, which selections bring it up, the apps it
 * skips, and the enabled commands
 * that read the selection, in command-list order. A click on one runs it like its shortcut
 * (`shortcut.command`), so only the id and the name the button shows cross.
 */
export function toolbarParams(
  settings: SelectionToolbarSettings,
  commands: readonly CommandDefinition[],
): CallParams<'toolbar.set'> {
  return {
    enabled: settings.enabled,
    activation: settings.activation,
    activationKeys: settings.activationKeys,
    showHud: settings.showHud,
    excludedBundleIds: settings.excludedApps.map((app) => app.bundleId),
    commands: commands
      .filter((command) => command.enabled && command.input.source === 'selection')
      .slice(0, MAX_TOOLBAR_COMMANDS)
      .map(({ id, name }) => ({ id, name })),
  };
}

/**
 * The panel's side of the selection toolbar: it pushes the toolbar's settings and commands to the
 * shell whenever either changes, once the service's settings loaded (`settings` is null before,
 * when the defaults could show a toolbar the user turned off). An unchanged set is not pushed
 * again; pushes run one at a time, in order.
 */
export function nativeToolbar(
  bridge: NativeBridge,
  host: {
    settings: () => SelectionToolbarSettings | null;
    commands: () => readonly CommandDefinition[];
  },
): { sync: () => void } {
  /** The set the shell last took. */
  let pushed = '';
  let queue = Promise.resolve();
  async function push() {
    const settings = host.settings();
    if (settings === null) return;
    const params = toolbarParams(settings, host.commands());
    const signature = JSON.stringify(params);
    if (signature === pushed) return;
    await bridge.call('toolbar.set', params);
    pushed = signature;
  }
  return {
    sync() {
      queue = queue.then(push).catch((error: unknown) => {
        console.error('The native shell did not take the selection toolbar:', error);
      });
    },
  };
}
