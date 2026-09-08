export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface Task {
  id: string;
  prompt: string;
  attachments: Attachment[];
  createdAt: string;
}

export interface SavedState {
  tasks: Task[];
  pinned: boolean;
}

export const STORAGE_KEY = 'ai.task-panel.v1';
export const MAX_TASKS = 50;
export const MAX_ATTACHMENTS = 6;
export const MAX_PROMPT_LENGTH = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAttachment(value: unknown): value is Attachment {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    value.name.length <= 255 &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    value.size >= 0 &&
    typeof value.type === 'string'
  );
}

function isTask(value: unknown): value is Task {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.prompt === 'string' &&
    value.prompt.length <= MAX_PROMPT_LENGTH &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    Array.isArray(value.attachments) &&
    value.attachments.length <= MAX_ATTACHMENTS &&
    value.attachments.every(isAttachment) &&
    (value.prompt.trim().length > 0 || value.attachments.length > 0)
  );
}

export function loadState(): SavedState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!isRecord(value) || value.version !== 1) return { tasks: [], pinned: true };
    return {
      tasks: Array.isArray(value.tasks) ? value.tasks.filter(isTask).slice(0, MAX_TASKS) : [],
      pinned: typeof value.pinned === 'boolean' ? value.pinned : true,
    };
  } catch {
    return { tasks: [], pinned: true };
  }
}

export function saveState(state: SavedState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state }));
    return true;
  } catch {
    return false;
  }
}

export function createTask(prompt: string, attachments: Attachment[]): Task | null {
  const trimmed = prompt.trim();
  if ((!trimmed && attachments.length === 0) || trimmed.length > MAX_PROMPT_LENGTH) return null;
  return {
    id: crypto.randomUUID(),
    prompt: trimmed,
    attachments: attachments.slice(0, MAX_ATTACHMENTS),
    createdAt: new Date().toISOString(),
  };
}

export function taskTitle(task: Task): string {
  return task.prompt || task.attachments[0]?.name || 'Untitled task';
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
