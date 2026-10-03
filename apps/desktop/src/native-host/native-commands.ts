import { parseAccelerator } from '@atd/agent-contracts';
import type { CommandCatalog } from '../client/agent/agent-requests';
import type { PreparedCommand } from '../client/agent/bridge';
import { prepareCommand } from '../client/agent/command-prepare';
import { deleteRemote, fetchCommands, saveRemote } from '../client/agent/command-remote';
import type { CommandDefinition } from '../client/agent/command-schema';
import { validateCommand } from '../client/agent/command-validation';
import type { Screenshot } from '../client/agent/screenshot-input';
import type { CallResult, NativeBridge } from '../native-bridge/client';
import { MAX_CAPTURE_LENGTH } from '../native-bridge/calls';
import type { NativeConnection } from './native-connection';

type SelectionFailure = Extract<CallResult<'capture'>, { ok: false }>['reason'];

/** The desktop's capture messages, so both hosts explain a failed read the same way. */
const SELECTION_ERRORS: Record<SelectionFailure, string> = {
  notTrusted: 'Enable Accessibility: System Settings → Privacy & Security → Accessibility.',
  noSelection: 'No selected text — select text in another app, then use the command shortcut.',
  tooLong: 'Selected text exceeds the input limit — select a smaller passage.',
};
/** macOS applies a new Screen Recording grant only to a relaunched app. */
const SCREENSHOT_NOT_PERMITTED =
  'Enable Screen Recording for AI: System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen AI.';

/** A capture or edit result as the page's screenshot; null when the user cancelled. */
function shotOf(result: CallResult<'screenshot.capture'>): Screenshot | null {
  if (result.ok)
    return { file: result.file, context: result.context, capturedAt: result.capturedAt };
  if (result.reason === 'notPermitted') throw new Error(SCREENSHOT_NOT_PERMITTED);
  return null;
}

/**
 * The command list as the WebView host keeps it: the service's commands, cached for the page.
 * `errors` holds each command's last shortcut registration or launch failure. The shell reads the
 * selection when a summon shows the panel; `capture` only takes what it stashed.
 */
export class NativeCommands implements CommandCatalog {
  readonly errors: Record<string, string> = {};
  private commands: CommandDefinition[] = [];

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
    if (!command)
      throw new Error('This command was deleted. Use its saved version from task history.');
    return command;
  }

  /** `expectCapture`: the command shortcut launched it, so a failed capture becomes a notice. */
  prepare(id: string, expectCapture = false): Promise<PreparedCommand> {
    return prepareCommand(this.find(id), this, expectCapture);
  }

  async capture(source: 'selection' | 'clipboard') {
    if (source === 'selection') {
      const captured = await this.bridge.call('capture', { source });
      if (!captured.ok) throw new Error(SELECTION_ERRORS[captured.reason]);
      if (!captured.text.trim()) throw new Error(SELECTION_ERRORS.noSelection);
      return { text: captured.text, capturedAt: captured.capturedAt };
    }
    const { text } = await this.bridge.call('clipboard.read', {});
    if (!text.trim()) throw new Error('The clipboard does not contain text.');
    if (text.length > MAX_CAPTURE_LENGTH)
      throw new Error('Clipboard text exceeds the input limit.');
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
    if (command.shortcut) command.shortcut = parseAccelerator(command.shortcut, true, 'darwin');
    const saved = await saveRemote(this.connection.options(), command, expectedRevision);
    this.commands = this.commands.some((item) => item.id === saved.id)
      ? this.commands.map((item) => (item.id === saved.id ? saved : item))
      : [...this.commands, saved];
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

  async refreshFromService() {
    this.commands = await fetchCommands(this.connection.options());
    this.changed();
  }
}
