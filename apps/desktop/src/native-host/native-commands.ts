import { commandShortcut, isBlankShortcut, parseAccelerator } from '@atd/agent-contracts';
import i18n from '../i18n';
import type { CommandCatalog } from '../client/agent/agent-requests';
import type { PreparedCommand } from '../client/agent/bridge';
import { prepareCommand, SelectionMissingError } from '../client/agent/command-prepare';
import {
  argumentOverrides,
  commandValues,
  sanitizeArguments,
  type CommandArguments,
} from '../client/agent/command-arguments';
import {
  deleteRemote,
  fetchCommands,
  rememberRemote,
  reorderRemote,
  saveRemote,
} from '../client/agent/command-remote';
import type { ArgumentValues, CommandDefinition } from '../client/agent/command-schema';
import { validateCommand } from '../client/agent/command-validation';
import type { Screenshot } from '../client/agent/screenshot-input';
import type { CallResult, NativeBridge } from '../native-bridge/client';
import { MAX_CAPTURE_LENGTH } from '../native-bridge/calls';
import type { NativeConnection } from './native-connection';

type SelectionFailure = Extract<CallResult<'capture'>, { ok: false }>['reason'];

/** Resolve capture notices when used, so they follow the current app language. */
const SELECTION_ERRORS = {
  notTrusted: 'input.errors.notTrusted',
  noSelection: 'input.errors.noSelection',
  tooLong: 'input.errors.selectionTooLong',
} as const satisfies Record<SelectionFailure, string>;

/** A capture or edit result as the page's screenshot; null when the user cancelled. */
function shotOf(result: CallResult<'screenshot.capture'>): Screenshot | null {
  if (result.ok)
    return { file: result.file, context: result.context, capturedAt: result.capturedAt };
  if (result.reason === 'notPermitted')
    throw new Error(i18n.t('input.errors.screenRecording', { ns: 'panel' }));
  return null;
}

/**
 * The command list as the WebView host keeps it: the service's commands, cached for the page.
 * `errors` holds the last failure of each command shortcut's registration (by shortcut id) and of
 * each command's launch (by command id), as `AgentSnapshot.shortcutErrors`. The shell reads the
 * selection when a summon shows the panel; `capture` only takes what it stashed.
 */
export class NativeCommands implements CommandCatalog {
  readonly errors: Record<string, string> = {};
  private commands: CommandDefinition[] = [];
  /** Remembered values go to the service one write after another (`remember`). */
  private remembering = Promise.resolve();

  constructor(
    private readonly connection: NativeConnection,
    private readonly bridge: NativeBridge,
    private readonly changed: () => void,
  ) {}

  list() {
    return this.commands;
  }

  find(id: string) {
    const command = this.commands.find((item) => item.id === id);
    if (!command) throw new Error(i18n.t('input.errors.commandDeleted', { ns: 'panel' }));
    return command;
  }

  /**
   * `expectCapture`: the command shortcut launched it, so a failed capture becomes a notice.
   * `overrides`: argument values picked for this launch, over the remembered ones and those the
   * launching shortcut `shortcutId` pins. Rejects when the command no longer has that shortcut, so
   * a launch never runs with the command's settings in place of a deleted shortcut's.
   */
  async prepare(
    id: string,
    expectCapture = false,
    overrides?: ArgumentValues,
    shortcutId?: string,
  ): Promise<PreparedCommand> {
    const command = this.find(id);
    const shortcut = shortcutId === undefined ? undefined : commandShortcut(command, shortcutId);
    if (shortcutId !== undefined && !shortcut)
      throw new Error(i18n.t('input.errors.shortcutDeleted', { ns: 'panel' }));
    return prepareCommand(command, this, expectCapture, overrides, shortcut);
  }

  /**
   * Prepared like a shortcut launch (a failed capture becomes a notice), but the selection the
   * command reads is `text`, captured now, so the shell's stashed selection stays untouched.
   */
  async prepareWithText(
    id: string,
    text: string,
    overrides?: ArgumentValues,
  ): Promise<PreparedCommand> {
    if (text.length > MAX_CAPTURE_LENGTH)
      throw new Error(i18n.t('input.errors.textTooLong', { ns: 'panel' }));
    const selection = { text, capturedAt: new Date().toISOString() };
    return prepareCommand(
      this.find(id),
      {
        capture: async (source) => (source === 'selection' ? selection : this.capture(source)),
        screenshot: () => this.screenshot(),
      },
      true,
      overrides,
    );
  }

  /** Nothing selected (or only whitespace) rejects with a `SelectionMissingError`. */
  async capture(source: 'selection' | 'clipboard') {
    if (source === 'selection') {
      const captured = await this.bridge.call('capture', { source });
      if (captured.ok ? !captured.text.trim() : captured.reason === 'noSelection')
        throw new SelectionMissingError(i18n.t(SELECTION_ERRORS.noSelection, { ns: 'panel' }));
      if (!captured.ok) throw new Error(i18n.t(SELECTION_ERRORS[captured.reason], { ns: 'panel' }));
      return { text: captured.text, capturedAt: captured.capturedAt };
    }
    const { text } = await this.bridge.call('clipboard.read', {});
    if (!text.trim()) throw new Error(i18n.t('input.errors.clipboardEmpty', { ns: 'panel' }));
    if (text.length > MAX_CAPTURE_LENGTH)
      throw new Error(i18n.t('input.errors.clipboardTooLong', { ns: 'panel' }));
    return { text, capturedAt: new Date().toISOString() };
  }

  /** The shell hides the panel while the user picks an area, a window or the screen. */
  async screenshot() {
    return shotOf(await this.bridge.call('screenshot.capture', {}));
  }

  /** Reopens an image attachment on the capture overlay; the result is a new resource. */
  async editScreenshot(resourceId: string) {
    return shotOf(await this.bridge.call('screenshot.edit', { resourceId }));
  }

  /** Conflicts with another action's shortcut are the service's to refuse. */
  async save(command: CommandDefinition, expectedRevision: number) {
    // A plugin command's content is the service's (read-only apart from `enabled`, which the
    // service enforces), so only the user's own commands pass the desktop instruction checks.
    const old = this.commands.find((item) => item.id === command.id);
    if (!old?.pluginId) validateCommand(command);
    // The shell registers command shortcuts globally, so one may be a modifier's double-tap. A
    // shortcut with no keys, name or overrides has nothing to keep.
    command.shortcuts = command.shortcuts
      .filter((shortcut) => !isBlankShortcut(shortcut))
      .map((shortcut) =>
        shortcut.accelerator
          ? {
              ...shortcut,
              accelerator: parseAccelerator(shortcut.accelerator, true, 'darwin', {
                allowDoubleTap: true,
              }),
            }
          : shortcut,
      );
    const saved = await saveRemote(this.connection.options(), command, expectedRevision);
    // A new command is the last of the user's, ahead of the plugins' as the service lists it.
    const own = this.commands.filter((item) => !item.pluginId);
    this.commands = this.commands.some((item) => item.id === saved.id)
      ? this.commands.map((item) => (item.id === saved.id ? saved : item))
      : [...own, saved, ...this.commands.filter((item) => item.pluginId)];
    delete this.errors[saved.id];
    this.changed();
    return saved;
  }

  async delete(id: string, revision: number) {
    this.find(id);
    await deleteRemote(this.connection.options(), id, revision);
    this.commands = this.commands.filter((item) => item.id !== id);
    delete this.errors[id];
    this.changed();
  }

  /** A refused order (the list changed meanwhile) reloads the list before it rejects. */
  async reorder(ids: string[]) {
    try {
      this.commands = await reorderRemote(this.connection.options(), ids);
    } catch (error) {
      await this.refreshFromService().catch(() => undefined);
      throw error;
    }
    this.changed();
  }

  /**
   * Remembers `values` as where command `id`'s next run starts, as a run with them would, without
   * running it: those its parameters accept, a blank text counting as none. Values picked on a
   * launch from shortcut `shortcutId` name it, so the service keeps what was remembered for the
   * keys it pins. Writes go in the order of the changes, so the last one stays.
   */
  remember(id: string, values: ArgumentValues, shortcutId?: string): Promise<void> {
    const write = this.remembering.then(async () => {
      const kept = sanitizeArguments(this.find(id), values);
      const saved = await rememberRemote(this.connection.options(), id, kept, shortcutId);
      this.commands = this.commands.map((item) => (item.id === saved.id ? saved : item));
      this.changed();
    });
    this.remembering = write.catch(() => undefined);
    return write;
  }

  /**
   * Remembers the choices and toggles `picked` in the shell's options menu for command `id`, over
   * the values its next run would start from; where the answer goes is never remembered. The menu
   * offers the command itself, never one of its shortcuts, so no shortcut's pinned values apply.
   */
  rememberPicks(id: string, picked: CommandArguments): Promise<void> {
    const command = this.find(id);
    return this.remember(id, commandValues(command, argumentOverrides(command, picked)));
  }

  async refreshFromService() {
    this.commands = await fetchCommands(this.connection.options());
    this.changed();
  }
}
