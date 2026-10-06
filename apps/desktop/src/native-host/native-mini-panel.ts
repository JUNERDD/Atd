import type { CommandDefinition } from '../client/agent/command-schema';
import type { CallParams, NativeBridge } from '../native-bridge/client';

/** Commands `miniPanel.setCommands` takes; the shell lists no more. */
const MAX_MINI_PANEL_COMMANDS = 64;

/**
 * What the mini panel's Commands flyout lists: the enabled commands, in command-list order. A
 * click on one runs it like its shortcut (`shortcut.command`), so only the id and the name its
 * row shows cross.
 */
export function miniPanelParams(
  commands: readonly CommandDefinition[],
): CallParams<'miniPanel.setCommands'> {
  return {
    commands: commands
      .filter((command) => command.enabled)
      .slice(0, MAX_MINI_PANEL_COMMANDS)
      .map(({ id, name }) => ({ id, name })),
  };
}

/**
 * The panel's side of the mini panel's command list: it pushes the list to the shell whenever the
 * commands change. The first push always goes, since the shell may still hold the list of an
 * earlier page; an unchanged list is not pushed again, and pushes run one at a time, in order.
 */
export function nativeMiniPanel(
  bridge: NativeBridge,
  host: { commands: () => readonly CommandDefinition[] },
): { sync: () => void } {
  /** The list the shell last took. */
  let pushed = '';
  let queue = Promise.resolve();
  async function push() {
    const params = miniPanelParams(host.commands());
    const signature = JSON.stringify(params);
    if (signature === pushed) return;
    await bridge.call('miniPanel.setCommands', params);
    pushed = signature;
  }
  return {
    sync() {
      queue = queue.then(push).catch((error: unknown) => {
        console.error('The native shell did not take the mini panel commands:', error);
      });
    },
  };
}
