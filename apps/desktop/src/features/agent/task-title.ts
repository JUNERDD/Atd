/** The longest title the service accepts for a task (`maxLength` in the tasks-manage contract). */
export const TASK_TITLE_LIMIT = 120;

/**
 * The title a rename would save: the trimmed name, or null when it is empty, too long, or the
 * task's current title, so there is nothing to send.
 */
export function renamedTitle(current: string, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > TASK_TITLE_LIMIT || trimmed === current.trim()) return null;
  return trimmed;
}
