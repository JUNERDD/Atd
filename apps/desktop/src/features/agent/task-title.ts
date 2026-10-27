/** The longest title the service accepts for a task (`maxLength` in the tasks-manage contract). */
export const TASK_TITLE_LIMIT = 120;

/**
 * The title a rename would save: the trimmed name, or null when it is empty, too long, or the
 * task's settled title. Confirming the same text while a summary is pending still saves: that
 * explicit name must take ownership from the background request.
 */
export function renamedTitle(current: string, name: string, pending = false): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > TASK_TITLE_LIMIT || (!pending && trimmed === current.trim()))
    return null;
  return trimmed;
}
