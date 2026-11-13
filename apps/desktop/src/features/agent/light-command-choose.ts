import type {
  CommandProgressAction,
  LightCommandBridge,
  PreparedCommand,
} from '../../client/agent/bridge';
import {
  argumentOverrides,
  commandOptions,
  type CommandArguments,
} from '../../client/agent/command-arguments';
import {
  launchSettings,
  runsAsIs,
  withoutSelectionNotice,
} from '../../client/agent/command-prepare';
import { outputOption, withOutputAction } from '../../client/agent/run-output';
import { startLightRun, type LightHost } from './light-command';
import { isLightLaunch, type LightLaunch } from './light-command-run';
import { composeLightRun } from './light-command-compose';
import { clearIsland, replaceIsland } from './island-owner';

function bridge(): LightCommandBridge | undefined {
  return window.desktop?.agent?.light;
}

/**
 * Offers a light launch's options before it runs (its shortcut was held, or the person changed
 * the values of its run): the progress HUD of its target shows the options card with the values
 * the launch would use and where its answer goes, replacing any other HUD as a newer launch does.
 * The launch waits for the card's answer (`answerChoice`). A launch with nothing selected
 * (composed on the island, or whose text the island asks for after the card) has no selection to
 * write over or after.
 */
export function chooseLightRun(launch: LightLaunch, light: LightCommandBridge): void {
  replaceIsland({
    key: launch.target.id,
    identity: launch,
    act: (action, host) => {
      if (action.action === 'pick') return rememberPicks(launch, action.arguments);
      answerChoice(launch, action, host);
    },
    supersede: () => undefined,
  });
  const state = {
    phase: 'choose' as const,
    command: launch.command.name,
    options: commandOptions(launch.command, launch.input.arguments),
    output: {
      ...outputOption(launch.command, launchSettings(launch).output.action, launch.output.action),
      ...(launch.composed || launch.selectionMissing ? { selection: false } : {}),
    },
  };
  light.show(launch.target.id, state).catch((error: unknown) => {
    console.error('The options card did not show:', error);
    clearIsland(launch);
  });
}

/** Takes the island of `launch` away; a repeat for an island already gone does nothing. */
function hideCard(launch: LightLaunch, light: LightCommandBridge | undefined): void {
  light?.hide(launch.target.id).catch((error: unknown) => {
    console.error('The options card did not hide:', error);
  });
}

/**
 * `launch` with the values the card picked over the ones it showed, and its answer going where
 * the card picked; the launch may then no longer be a light one.
 */
function withPicks(launch: LightLaunch, picked: CommandArguments | undefined): PreparedCommand {
  if (!picked) return launch;
  const values = { ...launch.input.arguments, ...argumentOverrides(launch.command, picked) };
  return withOutputAction(
    { ...launch, input: { ...launch.input, arguments: values } },
    picked.output,
  );
}

/**
 * The options card's answer for `launch`: `run` runs it with the picked values when they make it
 * ready (else its input step shows them, where the person completes it), light while its answer
 * still goes back into its field, else in the panel as any launch that runs as-is; `edit` shows
 * its input step with them, never running it; `cancel` (the card closed) drops it. Whatever does
 * not run light hides the island first, since the shell keeps a working state up after the card's
 * run or edit. A launch whose selection is missing runs nothing on `run`: the island asks for its
 * text next (`compose`), and its input step, where the text is typed, reports nothing missing.
 * Other actions do not belong to the card and leave it waiting.
 */
function answerChoice(
  launch: LightLaunch,
  { action, arguments: picked }: CommandProgressAction,
  host: LightHost,
): void {
  if (action !== 'run' && action !== 'edit' && action !== 'cancel') return;
  clearIsland(launch);
  const light = bridge();
  const chosen = withPicks(launch, picked);
  if (action === 'cancel') return hideCard(launch, light);
  // The compose card takes the island over from the card's working state, so it is not hidden.
  if (action === 'run' && chosen.selectionMissing && light)
    return composeLightRun(chosen, false, light);
  const ready = action === 'run' && runsAsIs(chosen);
  if (ready && light && isLightLaunch(chosen)) {
    startLightRun(chosen, light).catch((error: unknown) => {
      console.error('The light command run failed:', error);
    });
    return;
  }
  // The shell already turned the card into its working state, which only a hide takes away.
  hideCard(launch, light);
  if (ready) return host.run(chosen);
  host.showInput(withoutSelectionNotice(chosen));
  host.reveal();
}

/**
 * The options card of `launch` changed a value: the values the launch would now run with are
 * remembered at once as where the command's next run starts, whether the card then runs, edits
 * or closes. A launch from a shortcut names it, so the keys it pins keep what was remembered.
 */
function rememberPicks(launch: LightLaunch, picked: CommandArguments | undefined): void {
  if (!picked) return;
  const { command, input, shortcutId } = withPicks(launch, picked);
  window.desktop?.agent
    ?.rememberArguments?.(command.id, input.arguments, shortcutId)
    .catch((error: unknown) => {
      console.error('The picked command options were not remembered:', error);
    });
}
