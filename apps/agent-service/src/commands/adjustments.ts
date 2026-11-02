/**
 * The command with its adjustment suggestions (`adjustments`) as a save stores them: each trimmed,
 * blank ones dropped and a repeat dropped after its first appearance, in the order given. Trimming
 * and dropping only shorten the list, so it still meets `CommandAdjustmentsSchema` when the draft
 * did; an emptied list stays empty, which offers none, as an omitted one does. A draft without
 * `adjustments` stays as it is.
 */
export function withCanonicalAdjustments<T extends { adjustments?: string[] }>(command: T): T {
  if (!command.adjustments) return command;
  const kept = command.adjustments.map((adjustment) => adjustment.trim()).filter(Boolean);
  return { ...command, adjustments: [...new Set(kept)] };
}
