import { parseAccelerator } from '@ai/agent-contracts';
import type { CommandCatalog } from '../../electron/agent/agent-requests';
import type { PreparedCommand } from '../../electron/agent/bridge';
import { prepareCommand } from '../../electron/agent/command-prepare';
import { deleteRemote, fetchCommands, saveRemote } from '../../electron/agent/command-remote';
import type { CommandDefinition } from '../../electron/agent/command-schema';
import { validateCommand } from '../../electron/agent/command-validation';
import type { NativeBridge } from '../native-bridge/client';
import { MAX_CAPTURE_LENGTH, type CallResult } from '../native-bridge/contract';
import type { NativeConnection } from './native-connection';

type SelectionFailure = Extract<CallResult<'capture'>, { ok: false }>['reason'];

/** The desktop's capture messages, so both hosts explain a failed read the same way. */
const SELECTION_ERRORS: Record<SelectionFailure, string> = {
  notTrusted: 'Enable Accessibility: System Settings → Privacy & Security → Accessibility.',
  noSelection: 'No selected text — select text in another app, then use the command shortcut.',
  tooLong: 'Selected text exceeds the input limit — select a smaller passage.',
};

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
    return prepareCommand(this.find(id), (source) => this.capture(source), expectCapture);
  }

  async capture(source: 'selection' | 'clipboard') {
    if (source === 'selection') {
      const captured = await this.bridge.call('capture', { source });
      if (!captured.ok) throw new Error(SELECTION_ERRORS[captured.reason]);
      return { text: captured.text, capturedAt: captured.capturedAt };
    }
    const { text } = await this.bridge.call('clipboard.read', {});
    if (!text.trim()) throw new Error('The clipboard does not contain text.');
    if (text.length > MAX_CAPTURE_LENGTH)
      throw new Error('Clipboard text exceeds the input limit.');
    return { text, capturedAt: new Date().toISOString() };
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
