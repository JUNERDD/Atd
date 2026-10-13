import type {
  CommandProgressAction,
  LightCommandBridge,
  PreparedCommand,
} from '../../client/agent/bridge';
import { commandOptions, needsInput } from '../../client/agent/command-arguments';
import {
  runsAsIs,
  withComposedInput,
  withoutSelectionNotice,
} from '../../client/agent/command-prepare';
import {
  isLightLaunch,
  startLightRun,
  supersedeLightRun,
  type LightHost,
  type LightLaunch,
} from './light-command';
import { actOnLightAction, chooseLightRun, dropLightChoice } from './light-command-choose';

/** A launch whose compose card waits for its answer, under the card's island key. */
interface Composing {
  key: string;
  launch: PreparedCommand;
  /** The shell asked to offer the command's options first (its shortcut was held). */
  choose: boolean;
}

/** The launch whose compose card the island shows; a newer card replaces it. */
let composing: Composing | null = null;

function bridge(): LightCommandBridge | undefined {
  return window.desktop?.agent?.light;
}

function hideCard(key: string, light: LightCommandBridge | undefined): void {
  light?.hide(key).catch((error: unknown) => {
    console.error('The compose card did not hide:', error);
  });
}

/**
 * Asks on the island for what a launch found nothing selected for
 * (`PreparedCommand.selectionMissing`): the compose card takes the text that stands in for the
 * selection, and screenshots or files when the command takes files. The card is keyed by the
 * launch's write target, or by a key of its own when the launch recorded none; the panel stays
 * hidden and as it was. Like a newer launch, it replaces whatever the island showed: the light run
 * there is cancelled (`supersedeLightRun`) and an options card waits no more. The launch waits for
 * the card's answer (`actOnIslandAction`).
 */
export function composeLightRun(
  launch: PreparedCommand,
  choose: boolean,
  light: LightCommandBridge,
): void {
  supersedeLightRun();
  dropLightChoice();
  const waiting = { key: launch.target?.id ?? crypto.randomUUID(), launch, choose };
  composing = waiting;
  const { name, input } = launch.command;
  light
    .show(waiting.key, { phase: 'compose', command: name, attach: input.files })
    .catch((error: unknown) => {
      console.error('The compose card did not show:', error);
      if (composing === waiting) composing = null;
    });
}

/**
 * `composed` as a light launch keyed by the card, when it is one: a launch that recorded no field
 * gets the card's key as a target nothing is written to (`writable` false; such a target is
 * never written to or named), so a write-back still runs without the panel and its answer shows
 * on the island's answer card. Null when the launch does not run light (its answer goes to the
 * conversation or the clipboard, or it is reviewed first), so a run in the panel never carries
 * the stand-in target.
 */
function islandLaunch(composed: PreparedCommand, key: string): LightLaunch | null {
  const launch = composed.target
    ? composed
    : { ...composed, target: { id: key, app: '', writable: false } };
  return isLightLaunch(launch) ? launch : null;
}

/**
 * The compose card's answer for `waiting`, the island being already gone (a hide for its key is
 * harmless). `cancel` drops the launch. `run` goes on with what was composed: a held shortcut's
 * light launch offers its options first when the card can fill them; one that is ready runs light
 * when it can, else in the panel; one that still needs something (the text it requires, a value)
 * shows its input step with what was composed, as does a held shortcut's launch that does not run
 * light (its options are there). `open` shows the input step with what was composed. A `run` or
 * `open` without what was composed (the shell always sends it) runs nothing and shows the input
 * step. Other actions do not belong to the card and leave it waiting.
 */
function answerCompose(
  { key, launch, choose }: Composing,
  { action, compose }: CommandProgressAction,
  host: LightHost,
): void {
  if (action !== 'run' && action !== 'open' && action !== 'cancel') return;
  composing = null;
  const light = bridge();
  if (action === 'cancel') return hideCard(key, light);
  const composed = compose ? withComposedInput(launch, compose) : withoutSelectionNotice(launch);
  const lightLaunch = light ? islandLaunch(composed, key) : null;
  if (action === 'run' && compose) {
    if (light && lightLaunch) {
      const { command, input } = lightLaunch;
      const fillable =
        commandOptions(command, input.arguments).length > 0 &&
        !needsInput(command, input.arguments);
      if (choose && fillable) return chooseLightRun(lightLaunch, light);
      if (runsAsIs(lightLaunch)) {
        startLightRun(lightLaunch, light).catch((error: unknown) => {
          console.error('The light command run failed:', error);
        });
        return;
      }
    } else if (!choose && runsAsIs(composed)) {
      hideCard(key, light);
      return host.run(composed);
    }
  }
  hideCard(key, light);
  host.showInput(composed);
  host.reveal();
}

/**
 * A press on the progress HUD: the compose card's answer when the card of that target waits for
 * one, else the options card's or the light run's (`actOnLightAction`).
 */
export function actOnIslandAction(action: CommandProgressAction, host: LightHost): void {
  if (composing?.key === action.target) return answerCompose(composing, action, host);
  actOnLightAction(action, host);
}
