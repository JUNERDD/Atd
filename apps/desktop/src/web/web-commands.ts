import { parseAccelerator } from '@ai/agent-contracts';
import type { CommandCatalog } from '../../electron/agent/agent-requests';
import type { PreparedCommand } from '../../electron/agent/bridge';
import { prepareCommand } from '../../electron/agent/command-prepare';
import { deleteRemote, fetchCommands, saveRemote } from '../../electron/agent/command-remote';
import type { CommandDefinition } from '../../electron/agent/command-schema';
import { validateCommand } from '../../electron/agent/command-validation';
import type { WebConnection } from './web-connection';

/**
 * The command list as the web client keeps it: the service's commands, cached for the page.
 * Global command shortcuts belong to the desktop app, which registers them; the web client checks
 * their grammar before saving, and the service refuses one another action already holds. Reading the selection in another app
 * is desktop-only; the clipboard is read through the browser, which may ask for permission.
 */
export class WebCommands implements CommandCatalog {
  readonly errors: Record<string, string> = {};
  private commands: CommandDefinition[] = [];

  constructor(
    private readonly connection: WebConnection,
    private readonly platform: string,
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

  prepare(id: string): Promise<PreparedCommand> {
    return prepareCommand(this.find(id), (source) => this.capture(source), false);
  }

  async capture(source: 'selection' | 'clipboard') {
    if (source === 'selection')
      throw new Error('Reading the selection in another app needs the desktop app.');
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error('The clipboard does not contain text.');
    if (text.length > 100000) throw new Error('Clipboard text exceeds the input limit.');
    return { text, capturedAt: new Date().toISOString() };
  }

  async save(command: CommandDefinition, expectedRevision: number) {
    // A plugin command's content is the service's (read-only apart from `enabled`, which the
    // service enforces), so only the user's own commands pass the desktop instruction checks.
    const old = this.commands.find((item) => item.id === command.id);
    if (!old?.pluginId) validateCommand(command);
    if (command.shortcut)
      command.shortcut = parseAccelerator(command.shortcut, true, this.platform);
    const saved = await saveRemote(this.connection.options(), command, expectedRevision);
    this.commands = this.commands.some((item) => item.id === saved.id)
      ? this.commands.map((item) => (item.id === saved.id ? saved : item))
      : [...this.commands, saved];
    this.changed();
    return saved;
  }

  async delete(id: string, revision: number) {
    this.find(id);
    await deleteRemote(this.connection.options(), id, revision);
    this.commands = this.commands.filter((item) => item.id !== id);
    this.changed();
  }

  async refreshFromService() {
    this.commands = await fetchCommands(this.connection.options());
    this.changed();
  }
}
