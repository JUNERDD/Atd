/**
 * Operation-specific label and target for `command` calls. The tool takes `operation` plus
 * `commandId` / `fields` (see `CommandToolSchema`), so `list` / `get` / `save` read distinctly and
 * a save with a `commandId` is an update while one without is a create.
 */

export type CommandStepKey =
  | 'activity.step.command'
  | 'activity.step.commandList'
  | 'activity.step.commandGet'
  | 'activity.step.commandCreate'
  | 'activity.step.commandUpdate';

/** Row label for a `command` call; unknown shapes fall back to the generic manage label. */
export function commandStepKey(args: Record<string, unknown>): CommandStepKey {
  const operation = args.operation;
  if (operation === 'list') return 'activity.step.commandList';
  if (operation === 'get') return 'activity.step.commandGet';
  if (operation === 'save') {
    const id = args.commandId;
    return typeof id === 'string' && id
      ? 'activity.step.commandUpdate'
      : 'activity.step.commandCreate';
  }
  return 'activity.step.command';
}

/** Identity of a `command` call: the stored id, or the name being saved on create. */
export function commandTarget(args: Record<string, unknown>): string | null {
  const id = args.commandId;
  if (typeof id === 'string' && id) return id;
  const fields = args.fields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const name = (fields as Record<string, unknown>).name;
    if (typeof name === 'string' && name) return name;
  }
  return null;
}
