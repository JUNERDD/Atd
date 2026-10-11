import { commandOptions, commandValues } from '../client/agent/command-arguments';
import type { CommandDefinition } from '../client/agent/command-schema';
import type { CallParams, NativeBridge } from '../native-bridge/client';

/** Commands `commandOptions.set` takes. */
const MAX_OPTION_COMMANDS = 256;

/**
 * The commands whose options the shell offers (its toolbar options menu, the shortcut hold and
 * the HUD's options card): the enabled commands with at least one parameter, in command-list
 * order, each option showing the value a run would start from (defaults, then remembered values).
 */
export function commandOptionsParams(
  commands: readonly CommandDefinition[],
): CallParams<'commandOptions.set'> {
  return {
    commands: commands
      .filter((command) => command.enabled && command.parameters.length > 0)
      .slice(0, MAX_OPTION_COMMANDS)
      .map((command) => ({
        id: command.id,
        name: command.name,
        options: commandOptions(command, commandValues(command)),
      })),
  };
}

/**
 * The panel's side of the shell's command options: it pushes them whenever the commands change,
 * a run's remembered values included. The first push always goes, since the shell may still hold
 * the set of an earlier page; an unchanged set is not pushed again, and pushes run one at a time,
 * in order.
 */
export function nativeCommandOptions(
  bridge: NativeBridge,
  host: { commands: () => readonly CommandDefinition[] },
): { sync: () => void } {
  /** The set the shell last took. */
  let pushed = '';
  let queue = Promise.resolve();
  async function push() {
    const params = commandOptionsParams(host.commands());
    const signature = JSON.stringify(params);
    if (signature === pushed) return;
    await bridge.call('commandOptions.set', params);
    pushed = signature;
  }
  return {
    sync() {
      queue = queue.then(push).catch((error: unknown) => {
        console.error('The native shell did not take the command options:', error);
      });
    },
  };
}
