import type { PermissionTier } from './permission-schema';
import type { AgentTask } from './task-schema';
import type { AgentStore } from './store';

export const TASK_TITLE_LIMIT = 120;

/**
 * User-initiated AgentTask field writes (title, permission tier): validate the
 * input, persist it through the store, then publish the updated task. Worker
 * driven writes such as `rememberSession` stay with the runtime.
 */
export class TaskAttributes {
  constructor(
    private store: AgentStore,
    private lookup: (taskId: string) => AgentTask,
    private publish: (taskId: string) => void,
  ) {}

  async setPermissionTier(taskId: string, tier: PermissionTier) {
    this.lookup(taskId);
    await this.store.change((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error('This task no longer exists.');
      task.permissionTier = tier;
      task.updatedAt = new Date().toISOString();
    });
    this.publish(taskId);
  }

  async renameTask(taskId: string, title: string) {
    const next = title.trim();
    if (!next) throw new Error('Enter a session name.');
    if (next.length > TASK_TITLE_LIMIT)
      throw new Error('Keep the session name within 120 characters.');
    await this.store.change((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error('This task no longer exists.');
      task.title = next;
      task.updatedAt = new Date().toISOString();
    });
    this.publish(taskId);
  }
}
