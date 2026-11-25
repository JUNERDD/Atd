import type { SendFrame } from './native.ts';

/** The manifest command that opens the in-page ask. */
export const ASK_COMMAND = 'ask-on-page';

/** A command list younger than this is fresh enough for the selection bar. */
const STALE_MS = 30_000;
/** Do not ask again while a request this recent may still be answered. */
const RETRY_MS = 5_000;

/**
 * The person's Atd commands offered on selected text (`command.list` → `commands`). Requested only
 * while `ready()` (a ready channel and a pairing): after every `welcome`, once pairing completes,
 * and again when the selection bar opens on a list that has gone stale.
 */
export class CommandList {
  private receivedAt = 0;
  private requestedAt = 0;

  constructor(
    private readonly send: SendFrame,
    private readonly ready: () => boolean,
  ) {}

  request(): void {
    if (this.ready() && this.send({ t: 'command.list' })) this.requestedAt = Date.now();
  }

  refreshIfStale(): void {
    const now = Date.now();
    if (now - this.receivedAt < STALE_MS || now - this.requestedAt < RETRY_MS) return;
    this.request();
  }

  received(): void {
    this.receivedAt = Date.now();
  }
}

/** The ask command's shortcut as Chrome shows it (the person may change it), '' when unset. */
export async function askShortcut(): Promise<string> {
  const commands = await chrome.commands.getAll();
  return commands.find((command) => command.name === ASK_COMMAND)?.shortcut ?? '';
}
