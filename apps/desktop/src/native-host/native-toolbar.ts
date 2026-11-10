import { offeredAt, type CommandPlace, type SelectionToolbarSettings } from '@atd/agent-contracts';
import type { CommandDefinition } from '../client/agent/command-schema';
import type { CallParams, NativeBridge } from '../native-bridge/client';

/** Commands `toolbar.set` and `screenshotToolbar.set` take; the shell folds the rest into More. */
const MAX_TOOLBAR_COMMANDS = 64;

/** The commands offered at a toolbar `place`, in command-list order, as the shell's buttons. */
function offeredCommands(commands: readonly CommandDefinition[], place: CommandPlace) {
  return commands
    .filter((command) => offeredAt(command, place))
    .slice(0, MAX_TOOLBAR_COMMANDS)
    .map(({ id, name }) => ({ id, name }));
}

/**
 * What the selection toolbar offers: whether it shows, which selections bring it up, the apps it
 * skips, and the commands offered there (`offeredAt` its `selectionToolbar` place: enabled, placed
 * on the toolbar, and reading the selection), in command-list order. A click on one runs it like
 * its shortcut (`shortcut.command`), so only the id and the name the button shows cross.
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
    smallIcon: settings.smallIcon,
    position: settings.position,
    excludedBundleIds: settings.excludedApps.map((app) => app.bundleId),
    commands: offeredCommands(commands, 'selectionToolbar'),
  };
}

/**
 * What the screenshot toolbar offers: the commands offered at its place (`offeredAt`: enabled,
 * placed there, and taking a screenshot), in command-list order. Picking one ends the capture
 * with it (`screenshot.capture`'s `launch`), so only the id and the name the button shows cross.
 */
export function screenshotToolbarParams(
  commands: readonly CommandDefinition[],
): CallParams<'screenshotToolbar.set'> {
  return { commands: offeredCommands(commands, 'screenshotToolbar') };
}

/**
 * The panel's side of the selection and screenshot toolbars: each sync pushes what changed of
 * either to the shell. The screenshot toolbar follows the commands alone; the selection toolbar
 * also its settings, so it waits until the service's settings loaded (`settings` is null before,
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
  /** The sets the shell last took. */
  let pushed = '';
  let pushedScreenshot = '';
  async function pushSelection() {
    const settings = host.settings();
    if (settings === null) return;
    const params = toolbarParams(settings, host.commands());
    const signature = JSON.stringify(params);
    if (signature === pushed) return;
    await bridge.call('toolbar.set', params);
    pushed = signature;
  }
  async function pushScreenshot() {
    const params = screenshotToolbarParams(host.commands());
    const signature = JSON.stringify(params);
    if (signature === pushedScreenshot) return;
    await bridge.call('screenshotToolbar.set', params);
    pushedScreenshot = signature;
  }
  let queue = Promise.resolve();
  return {
    sync() {
      // One toolbar the shell refused does not keep the other from being pushed.
      queue = queue
        .then(pushSelection)
        .catch((error: unknown) => {
          console.error('The native shell did not take the selection toolbar:', error);
        })
        .then(pushScreenshot)
        .catch((error: unknown) => {
          console.error('The native shell did not take the screenshot toolbar:', error);
        });
    },
  };
}
