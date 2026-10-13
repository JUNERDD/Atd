import {
  commandOptions,
  commandValues,
  type CommandArguments,
} from '../client/agent/command-arguments';
import type { CommandDefinition } from '../client/agent/command-schema';
import { outputOption } from '../client/agent/run-output';
import type { CallParams, NativeBridge } from '../native-bridge/client';

/** Commands `commandOptions.set` takes. */
const MAX_OPTION_COMMANDS = 256;

/**
 * The commands whose options the shell offers (its toolbar options menu, the shortcut hold and
 * the HUD's options card): every enabled command, in command-list order, each parameter's option
 * showing the value a run would start from (defaults, then remembered values), and where its
 * answer goes, starting from the command's saved output (a pick is never remembered).
 */
export function commandOptionsParams(
  commands: readonly CommandDefinition[],
): CallParams<'commandOptions.set'> {
  return {
    commands: commands
      .filter((command) => command.enabled)
      .slice(0, MAX_OPTION_COMMANDS)
      .map((command) => ({
        id: command.id,
        name: command.name,
        options: commandOptions(command, commandValues(command)),
        output: outputOption(command),
      })),
  };
}

/**
 * The panel's side of the shell's command options: it pushes them whenever the commands change,
 * a run's remembered values included. The first push always goes, since the shell may still hold
 * the set of an earlier page; an unchanged set is not pushed again, and pushes run one at a time,
 * in order. A value changed in the toolbar's options menu (`commandOptions.picked`) is remembered
 * at once (`host.remember`).
 */
export function nativeCommandOptions(
  bridge: NativeBridge,
  host: {
    commands: () => readonly CommandDefinition[];
    remember: (id: string, picked: CommandArguments) => Promise<void>;
  },
): { sync: () => void } {
  bridge.on('commandOptions.picked', ({ id, arguments: picked }) => {
    host.remember(id, picked).catch((error: unknown) => {
      console.error('The picked command options were not remembered:', error);
    });
  });
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
