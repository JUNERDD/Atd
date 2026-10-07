import { offeredAt } from '@atd/agent-contracts';
import type { CommandDefinition } from '../../../client/agent/command-schema';
import { useAgent } from '../use-agent';

/**
 * Opens an offered command on `text` (selected answer text, or a turn's answer), which stands in
 * for the selection the command reads. Closing what it opens returns focus to `origin` while that
 * is still on the page; null when the control that chose the command goes away with its choice (the
 * selection toolbar closes as the selection clears).
 */
export type CommandOpener = (
  command: CommandDefinition,
  text: string,
  origin: HTMLElement | null,
) => void;

/**
 * The commands a conversation offers at `place` (the toolbar over its selected answer text, or a
 * settled turn's actions) in the command list's order: exactly those `offeredAt` admits.
 */
export function useOfferedCommands(place: 'turnSelection' | 'turnActions'): CommandDefinition[] {
  const commands = useAgent().snapshot?.commands ?? [];
  return commands.filter((command) => offeredAt(command, place));
}
