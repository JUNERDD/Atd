import type { CommandProgressAction, LightCommandBridge } from '../../client/agent/bridge';
import {
  argumentOverrides,
  commandOptions,
  type CommandArguments,
} from '../../client/agent/command-arguments';
import { runsAsIs } from '../../client/agent/command-prepare';
import {
  actOnProgress,
  changeLightRun,
  startLightRun,
  supersedeLightRun,
  type LightHost,
  type LightLaunch,
} from './light-command';

/**
 * The light launch whose options card the progress HUD shows, kept until the card answers for its
 * write target; a newer card replaces it.
 */
let choosing: LightLaunch | null = null;

function bridge(): LightCommandBridge | undefined {
  return window.desktop?.agent?.light;
}

/**
 * Offers a light launch's options before it runs (its shortcut was held, or the person changed
 * the values of its run): the progress HUD of its target shows the options card with the values
 * the launch would use, replacing any other HUD as a newer launch does. The launch waits for the
 * card's answer (`actOnLightAction`).
 */
export function chooseLightRun(launch: LightLaunch, light: LightCommandBridge): void {
  supersedeLightRun();
  choosing = launch;
  const state = {
    phase: 'choose' as const,
    command: launch.command.name,
    options: commandOptions(launch.command, launch.input.arguments),
  };
  light.show(launch.target.id, state).catch((error: unknown) => {
    console.error('The options card did not show:', error);
    if (choosing === launch) choosing = null;
  });
}

/** Takes the island of `launch` away; a repeat for an island already gone does nothing. */
function hideCard(launch: LightLaunch, light: LightCommandBridge | undefined): void {
  light?.hide(launch.target.id).catch((error: unknown) => {
    console.error('The options card did not hide:', error);
  });
}

/** `launch` with the values the card picked over the ones it showed. */
function withArguments(launch: LightLaunch, picked: CommandArguments | undefined): LightLaunch {
  if (!picked) return launch;
  const values = { ...launch.input.arguments, ...argumentOverrides(launch.command, picked) };
  return { ...launch, input: { ...launch.input, arguments: values } };
}

/**
 * The options card's answer for `launch`: `run` runs it with the picked values when they make it
 * ready (else its input step shows them, where the person completes it); `edit` shows its input
 * step with them, never running it; `cancel` (the card closed) drops it. Whatever does not run
 * hides the island first, since the shell keeps a working state up after the card's run or edit.
 * Other actions do not belong to the card and leave it waiting.
 */
function answerChoice(
  launch: LightLaunch,
  { action, arguments: picked }: CommandProgressAction,
  host: LightHost,
): void {
  if (action !== 'run' && action !== 'edit' && action !== 'cancel') return;
  choosing = null;
  const light = bridge();
  const chosen = withArguments(launch, picked);
  if (action === 'cancel') return hideCard(launch, light);
  if (action === 'run' && light && runsAsIs(chosen)) {
    startLightRun(chosen, light).catch((error: unknown) => {
      console.error('The light command run failed:', error);
    });
    return;
  }
  // The shell already turned the card into its working state, which only a hide takes away.
  hideCard(launch, light);
  host.showInput(chosen);
  host.reveal();
}

/**
 * A press on the progress HUD: the options card's answer when the card of that target waits for
 * one; a change of a working run's values stops the run and offers its options again with the
 * values it ran with (`changeLightRun`); anything else is the light run's (`actOnProgress`).
 */
export function actOnLightAction(action: CommandProgressAction, host: LightHost): void {
  if (choosing?.target.id === action.target) return answerChoice(choosing, action, host);
  if (action.action !== 'change') return actOnProgress(action, host);
  const light = bridge();
  const changed = changeLightRun(action.target);
  if (changed && light) chooseLightRun(changed, light);
}
