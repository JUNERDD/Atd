import {
  actsOnSelection,
  commandHoldingShortcut,
  commandShortcutHolder,
  effectiveAccelerator,
  isBlankShortcut,
  MAX_COMMAND_SHORTCUTS,
  parseAccelerator,
  readsSelection,
  RESERVED_SHORTCUT_IDS,
  selectionToolbarDoubleTap,
  type CommandShortcut,
  type SelectionToolbarGesture,
  type ServiceCommandFull,
  type ShortcutBindingsWire,
  type ShortcutCommand,
  type ShortcutHolder,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { parameterError } from './templates.js';

/**
 * Command shortcut rules. The command store enforces them on every write, whichever client or
 * tool makes it; the settings routes enforce them when application shortcuts change. The service
 * runs on the machine whose desktop registers the shortcuts, so its own platform decides the
 * grammar and which accelerators collide. Messages are English and name a shortcut by its keys,
 * else its name, and a pinned value by its parameter key.
 */

/** Application shortcut actions as the settings name them, for conflict messages. */
const APP_SHORTCUT_NAMES: Record<keyof ShortcutBindingsWire, string> = {
  togglePanel: 'Toggle panel',
  captureScreenshot: 'Capture screenshot',
  newConversation: 'New conversation',
  openSettings: 'Open settings',
  sendMessage: 'Send message',
  newLine: 'New line',
};

/** What the selection toolbar's double-tap holder is called in conflict messages. */
const SELECTION_TOOLBAR_OWNER =
  'the selection toolbar, which turns on and off with this double-tap in its "Press keys twice" mode';

/** `accelerator` validated for this platform and in canonical form; TypeError when it is not. */
function canonicalAccelerator(accelerator: string): string {
  try {
    // The desktop registers command shortcuts globally, so they may be a modifier's double-tap.
    return parseAccelerator(accelerator, true, process.platform, { allowDoubleTap: true });
  } catch {
    const doubleTap =
      process.platform === 'darwin'
        ? ' Or double-tap one modifier: DoubleTap+Command, DoubleTap+Alt, DoubleTap+Control or DoubleTap+Shift.'
        : '';
    throw new TypeError(
      `"${accelerator}" is not a supported shortcut. Use an Electron accelerator that includes CommandOrControl, Command, Control, Alt or Super, such as CommandOrControl+Alt+S.${doubleTap}`,
    );
  }
}

/**
 * The command with its shortcuts as a save stores them: rows with no keys, name or overrides
 * dropped (`isBlankShortcut`, what an editor leaves behind) and every accelerator validated and in
 * canonical form, so equal keys always compare equal. Throws TypeError for keys this platform
 * cannot register. A draft without `shortcuts` stays as it is.
 */
export function withCanonicalShortcuts<T extends { shortcuts?: CommandShortcut[] }>(command: T): T {
  if (!command.shortcuts) return command;
  const shortcuts = command.shortcuts
    .filter((shortcut) => !isBlankShortcut(shortcut))
    .map((shortcut) =>
      shortcut.accelerator
        ? { ...shortcut, accelerator: canonicalAccelerator(shortcut.accelerator) }
        : shortcut,
    );
  return { ...command, shortcuts };
}

/** How a message opens on `shortcut`: by its keys, else its name. */
function subject(shortcut: { accelerator: string; name: string }): string {
  if (shortcut.accelerator) return `The shortcut ${shortcut.accelerator}`;
  if (shortcut.name) return `The shortcut "${shortcut.name}"`;
  return 'A shortcut without keys';
}

/**
 * What a save checks of a command's own shortcuts (`validateCommandSave`), as a TypeError; they
 * are expected canonical (`withCanonicalShortcuts`). What depends on other commands or the
 * settings is `assertShortcutsFree`'s.
 *
 * - At most `MAX_COMMAND_SHORTCUTS`.
 * - Each has its own id, never a reserved one (`RESERVED_SHORTCUT_IDS`) or the command's id: the
 *   shell registers a shortcut under its id, and the toolbar launches a command by the command id,
 *   which must never read as one of its shortcuts.
 * - No two press the same keys, even while the command is off: turning it on registers both.
 * - Each pinned value is for a parameter the command declares and is a value that parameter
 *   accepts, as a run's or a remembered value must be (`parameterError`).
 * - An output override is one the command's input can take: an answer written over or after the
 *   selection needs a command that reads it, as the command's own output does.
 */
export function validateShortcuts(command: ServiceCommandFull): void {
  if (command.shortcuts.length > MAX_COMMAND_SHORTCUTS)
    throw new TypeError(`A command can have at most ${MAX_COMMAND_SHORTCUTS} shortcuts.`);
  const ids = new Set<string>();
  const pressed = new Set<string>();
  for (const shortcut of command.shortcuts) {
    const named = subject(shortcut);
    if (ids.has(shortcut.id))
      throw new TypeError(
        `${named} has the id ${shortcut.id}, which another shortcut of this command already has. Give each shortcut its own id.`,
      );
    ids.add(shortcut.id);
    if (RESERVED_SHORTCUT_IDS.includes(shortcut.id) || shortcut.id === command.id)
      throw new TypeError(
        `${named} cannot have the id ${shortcut.id}, which belongs to ${shortcut.id === command.id ? 'the command itself' : "one of the app's own shortcuts"}. Give it another id.`,
      );
    if (shortcut.accelerator) {
      const keys = effectiveAccelerator(shortcut.accelerator, process.platform);
      if (pressed.has(keys))
        throw new TypeError(
          `Two shortcuts of this command use ${shortcut.accelerator}. Give each its own keys.`,
        );
      pressed.add(keys);
    }
    for (const [key, value] of Object.entries(shortcut.arguments)) {
      const parameter = command.parameters.find((item) => item.key === key);
      if (!parameter)
        throw new TypeError(
          `${named} pins a value for "${key}", which is not a parameter of this command. Remove the value or add the parameter.`,
        );
      const problem = parameterError(parameter, value);
      if (problem)
        throw new TypeError(
          `${named} pins a value for "${key}" that the parameter does not accept: ${problem}`,
        );
    }
    const action = shortcut.output?.action;
    if (action && actsOnSelection(action) && !readsSelection(command.input))
      throw new TypeError(
        `${named} sends its answer to ${action}, which writes over or after the selected text, so the command must read it: set input.source to selection or input.selection to true, or choose another output for the shortcut (insertAtCursor, copy or panel), or none to follow the command.`,
      );
  }
}

/** How conflict messages name a command's shortcut: by its name when the person gave one. */
function commandOwner(command: { name: string }, shortcut: { name: string }): string {
  return shortcut.name
    ? `the shortcut "${shortcut.name}" of the command "${command.name}"`
    : `the command "${command.name}"`;
}

/** How conflict messages name what holds keys a shortcut of command `ownId` wants. */
function holderName(holder: ShortcutHolder, ownId: string): string {
  switch (holder.kind) {
    case 'app':
      return `the app shortcut "${APP_SHORTCUT_NAMES[holder.action]}"`;
    case 'selectionToolbar':
      return SELECTION_TOOLBAR_OWNER;
    case 'command':
      return holder.id === ownId
        ? 'another shortcut of this command'
        : commandOwner(holder, { name: holder.shortcutName });
  }
}

/**
 * Throws a ConflictError when saving `command` would make it collide with what is already there:
 *
 * - Ids, whether or not anything is enabled: one of its shortcut ids is another command's id or
 *   one of its shortcut ids, or its own id is a shortcut id of another command. The shell
 *   registers shortcuts by id and the toolbar launches commands by id, so every one of them is
 *   unique across the store.
 * - Keys, while the command is enabled: one of its keyed shortcuts presses keys that an
 *   application action, the selection toolbar's double-tap or a shortcut of an enabled command
 *   (another of its own included) already holds (`commandShortcutHolder`).
 *
 * `commands` is the stored list; the command as it is about to be saved stands in for its stored
 * self. Another application holding the keys is only known when the desktop registers them.
 */
export function assertShortcutsFree(
  command: ShortcutCommand,
  commands: ReadonlyArray<ShortcutCommand>,
  appShortcuts: ShortcutBindingsWire,
  selectionToolbar: SelectionToolbarGesture,
): void {
  const others = commands.filter((item) => item.id !== command.id);
  for (const other of others) {
    const taken = command.shortcuts.find(
      (shortcut) =>
        shortcut.id === other.id || other.shortcuts.some((item) => item.id === shortcut.id),
    );
    if (taken)
      throw new ConflictError(
        `${subject(taken)} has the id ${taken.id}, which the command "${other.name}" already uses. Give the shortcut a new id.`,
      );
    if (other.shortcuts.some((item) => item.id === command.id))
      throw new ConflictError(
        `The command id ${command.id} is already the id of a shortcut of the command "${other.name}". Give the command another id.`,
      );
  }
  if (!command.enabled) return;
  const saved = [...others, command];
  for (const shortcut of command.shortcuts) {
    const holder = commandShortcutHolder(
      shortcut,
      appShortcuts,
      saved,
      process.platform,
      selectionToolbar,
    );
    if (holder)
      throw new ConflictError(
        `The shortcut ${shortcut.accelerator} is already used by ${holderName(holder, command.id)}. Choose another combination.`,
      );
  }
}

/** The enabled command's shortcut holding `accelerator`, named for a conflict message. */
function heldBy(accelerator: string, commands: ReadonlyArray<ShortcutCommand>): string | null {
  const held = commandHoldingShortcut(accelerator, commands, process.platform);
  return held ? commandOwner(held.command, held.shortcut) : null;
}

/**
 * Refuses settings that make a shortcut collide (ConflictError): an application action changed to
 * keys a shortcut of an enabled command or the selection toolbar's double-tap holds, or the
 * toolbar's double-tap changed to one an application action or an enabled command's shortcut
 * holds. Both sides are read as the patch leaves them, so a patch changing both is checked
 * against itself; the bindings are already valid (`parseShortcutBindings`). Unchanged parts are
 * not checked, so a save never fails over a conflict it did not make.
 */
export function assertSettingsShortcutsFree(
  next: { shortcuts: ShortcutBindingsWire; selectionToolbar: SelectionToolbarGesture },
  previous: { shortcuts: ShortcutBindingsWire; selectionToolbar: SelectionToolbarGesture },
  commands: ReadonlyArray<ShortcutCommand>,
): void {
  const toolbarTap = selectionToolbarDoubleTap(next.selectionToolbar);
  for (const [action, value] of Object.entries(next.shortcuts) as Array<
    [keyof ShortcutBindingsWire, string]
  >) {
    if (
      effectiveAccelerator(value, process.platform) ===
      effectiveAccelerator(previous.shortcuts[action], process.platform)
    )
      continue;
    if (value === toolbarTap)
      throw new ConflictError(
        `The shortcut ${value} for "${APP_SHORTCUT_NAMES[action]}" is already used by ${SELECTION_TOOLBAR_OWNER}. Choose another combination.`,
      );
    const holder = heldBy(value, commands);
    if (holder)
      throw new ConflictError(
        `The shortcut ${value} for "${APP_SHORTCUT_NAMES[action]}" is already used by ${holder}. Choose another combination.`,
      );
  }
  if (!toolbarTap || toolbarTap === selectionToolbarDoubleTap(previous.selectionToolbar)) return;
  const action = (Object.keys(next.shortcuts) as Array<keyof ShortcutBindingsWire>).find(
    (key) => next.shortcuts[key] === toolbarTap,
  );
  const owner = action
    ? `the app shortcut "${APP_SHORTCUT_NAMES[action]}"`
    : heldBy(toolbarTap, commands);
  if (owner)
    throw new ConflictError(
      `The selection toolbar's "Press keys twice" mode would turn on and off with ${toolbarTap}, which ${owner} already uses. Choose other keys or another way to show the toolbar.`,
    );
}
