import type { Lang } from '../../copy.ts';
import type { MenuItem } from './options-menu.ts';
import { fill, strings } from './strings.ts';

/**
 * Where a run's answer goes, as the shell's options offer it for one run (`CommandOutputChoice`):
 * one more choice, "When done", after a command's parameters. It lists the destinations in the
 * command settings' order, leaves out the two on the selection for a command that does not read
 * it, and names the command's saved destination "… (default)". A pick lasts for that run only.
 */
export const OUTPUT_ACTIONS = [
  'panel',
  'replaceSelection',
  'insertAfterSelection',
  'insertAtCursor',
  'copy',
] as const;

export type OutputAction = (typeof OUTPUT_ACTIONS)[number];

export interface OutputChoice {
  /** "When done": the choice's label (a menu row's title, a drilled card's title). */
  label: string;
  /** The destinations offered, in order. */
  actions: OutputAction[];
  /** Their names, the saved one as "… (default)"; a card numbers them 1–9 in this order. */
  values: string[];
  /** The index of the destination this run goes to now (the check); -1 if it is not offered. */
  current: number;
}

interface OutputChoiceOptions {
  /** The command's saved destination (its Result setting). */
  saved: OutputAction;
  /** The destination picked for this run; default the saved one. */
  current?: OutputAction | undefined;
  /** Whether the command reads the selection; without it the selection actions are left out. */
  selection?: boolean | undefined;
}

/** The "When done" choice for a command saved to `saved`. */
export function outputChoice(
  lang: Lang,
  { saved, current = saved, selection = true }: OutputChoiceOptions,
): OutputChoice {
  const t = strings[lang].command.output;
  const actions = OUTPUT_ACTIONS.filter(
    (action) => selection || (action !== 'replaceSelection' && action !== 'insertAfterSelection'),
  );
  return {
    label: t.label,
    actions,
    values: actions.map((action) =>
      action === saved ? fill(t.saved, { name: t[action] }) : t[action],
    ),
    current: actions.indexOf(current),
  };
}

/**
 * The choice as a toolbar menu lists it: one row per destination with the check in the trailing
 * slot on the current one (the others keep the slot blank), as the options menu of a command with
 * no parameters, or the submenu of its "When done" row.
 */
export function outputMenuItems(choice: OutputChoice): MenuItem[] {
  return choice.values.map((title, index) => ({
    title,
    mark: index === choice.current ? 'check' : 'blank',
  }));
}

/**
 * The "When done" row of a menu with several options: its label, the current destination as its
 * detail (every other name reserved, so the menu keeps its width), and the submenu chevron. The
 * Run row's values summary leaves the destination out, since this row shows it.
 */
export function outputMenuRow(choice: OutputChoice): MenuItem {
  return {
    title: choice.label,
    detail: choice.values[choice.current] ?? '',
    reserved: choice.values,
    submenu: true,
  };
}
