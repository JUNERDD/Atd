import type {
  CommandProgressAction,
  PreparedCommand,
  SubmitRequest,
} from '../../client/agent/bridge';
import { argumentOverrides } from '../../client/agent/command-arguments';
import type {
  ArgumentValues,
  CommandDefinition,
  Parameter,
} from '../../client/agent/command-schema';
import { emptyInput } from '../../client/agent/task-schema';
import i18n from '../../i18n';
import { argumentText } from '../commands/shortcut-names';
import { draftChips, quoteChip, serialize } from '../composer-editor/draft';

/**
 * The launch a review makes its versions from: the command (or synthetic Ask), the input its
 * first run read, where its answer goes and the shortcut that launched it.
 */
export type ReviewLaunch = Pick<PreparedCommand, 'command' | 'input' | 'output' | 'shortcutId'> & {
  /** True when the run is a free-form Ask rather than a saved command. */
  ask?: boolean;
};

/** What the review card staged for the next version (`CommandProgressAction.adjust`). */
type ReviewAdjust = NonNullable<CommandProgressAction['adjust']>;

/**
 * How the next version of a review is made, always as one run in the review's task: `command`
 * runs the command again on the launch's input with `values`; `followUp` sends `text` as a
 * message after the answers so far, quoting `quote` (the answer it adjusts) when that is not the
 * task's latest answer. `values` are the option values the version is shown with either way.
 */
export type VersionPlan =
  | { kind: 'command'; values: ArgumentValues }
  | { kind: 'followUp'; values: ArgumentValues; text: string; quote: string | null };

/** The version a plan starts from: the one the card shows. */
interface BaseVersion {
  answer: string;
  values: ArgumentValues;
}

/** A changed option as the message names it: "label: value", in the app's language. */
function optionLine(parameter: Parameter, value: string | number | boolean): string {
  const t = i18n.getFixedT(null, 'commands');
  return t('shortcut.name.value', {
    label: parameter.label,
    value: argumentText(parameter, value, t),
  });
}

/** A value as a run reads it: a switch with no value (no default, never set) is off. */
function effective(parameter: Parameter, value: string | number | boolean | undefined) {
  return parameter.type === 'boolean' ? value === true : value;
}

/**
 * The next version an adjustment on the card asks for, from `base`, the version the card shows
 * (`latest` when its answer is the task's latest). Once any option changes the card sends every
 * value, so only values that differ from the version's as a run reads them (`effective`; the
 * version's values already hold the defaults) count as changed, and only those join its values.
 * Changed values alone run the command again with them (`options`). Chosen adjustments or typed
 * text make one follow-up (`adjust`): the changed options first, one per line, then the
 * adjustments in the order chosen, then the text, so options and words together still make one
 * version; the version then shows the changed values. Null when the adjustment changes nothing.
 */
export function adjustPlan(
  command: CommandDefinition,
  base: BaseVersion,
  latest: boolean,
  adjust: ReviewAdjust,
): { kind: 'adjust' | 'options'; plan: VersionPlan } | null {
  const picked = adjust.arguments ? argumentOverrides(command, adjust.arguments) : {};
  const changes = command.parameters.flatMap((parameter) => {
    const value = picked[parameter.key];
    return value !== undefined &&
      effective(parameter, value) !== effective(parameter, base.values[parameter.key])
      ? [{ parameter, value }]
      : [];
  });
  const values = {
    ...base.values,
    ...Object.fromEntries(changes.map(({ parameter, value }) => [parameter.key, value])),
  };
  const changed = changes.map(({ parameter, value }) => optionLine(parameter, value));
  const text = adjust.text.trim();
  if (!text && !adjust.adjustments.length)
    return changed.length ? { kind: 'options', plan: { kind: 'command', values } } : null;
  const lines = [...changed, ...adjust.adjustments, ...(text ? [text] : [])];
  return {
    kind: 'adjust',
    plan: { kind: 'followUp', values, text: lines.join('\n'), quote: latest ? null : base.answer },
  };
}

/**
 * The submit that makes the version `plan` describes in the review's task `taskId`. A command run
 * repeats the launch (its input, where its answer goes, its shortcut) with the plan's values, and
 * fails as a stale launch would when the command changed since. A follow-up is the plan's text,
 * after a quote chip of the answer it adjusts when there is one (the run reads the passage from
 * the chip, as it reads any quote); it keeps the task's model, tools and memory (no policy).
 */
export function versionRequest(
  launch: ReviewLaunch,
  taskId: string,
  plan: VersionPlan,
): Omit<SubmitRequest, 'action'> {
  const base = { invocationId: crypto.randomUUID(), policy: null, taskId, savedRun: null };
  if (plan.kind === 'command') {
    if (launch.ask)
      return {
        ...base,
        commandId: null,
        commandRevision: null,
        input: launch.input,
        output: launch.output,
      };
    return {
      ...base,
      commandId: launch.command.id,
      commandRevision: launch.command.revision,
      input: { ...launch.input, arguments: plan.values },
      output: launch.output,
      ...(launch.shortcutId === undefined ? {} : { shortcutId: launch.shortcutId }),
    };
  }
  const draft =
    plan.quote === null
      ? { text: plan.text, chips: [] }
      : serialize([quoteChip(plan.quote), ' ', plan.text]);
  return {
    ...base,
    commandId: null,
    commandRevision: null,
    input: { ...emptyInput(), text: draft.text, chips: draftChips(draft) },
  };
}
