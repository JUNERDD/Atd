import {
  AgentClientError,
  deleteTask,
  listMemory,
  patchTask,
  pauseMemory,
  previewTask,
  replaceQueue,
  updateMemory,
  type AgentClientOptions,
} from '@ai/agent-client';
import {
  snapshotToolsFor,
  type PreviewTaskRequest,
  type ServiceRunPolicy,
} from '@ai/agent-contracts';
import type { MemoryEntry, MemorySnapshot } from './bridge';
import type { RunPolicy } from './run-policy';
import type { RunSnapshot } from './task-schema';

export function notConnected(): Error {
  return new Error('The service is not connected. Connect in Settings → Service.');
}

export function manageError(error: unknown): never {
  if (error instanceof AgentClientError) {
    if (error.status === 409) throw new Error(error.message);
    if (error.status === 410) throw new Error('This request expired. Review the current task.');
    throw new Error(error.message);
  }
  throw error instanceof Error ? error : new Error('The service request failed.');
}

export function mapRunPolicy(policy: RunPolicy | null | undefined): ServiceRunPolicy | undefined {
  if (!policy) return undefined;
  return {
    tools: snapshotToolsFor(policy.tools),
    memory: policy.memory,
    useDefaultModel: policy.useDefaultModel,
    confirmExpansion: policy.confirmExpansion,
    ...(policy.model ? { model: policy.model } : {}),
    ...(policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
    ...(policy.skills ? { skills: policy.skills } : {}),
    ...(policy.roleId ? { roleId: policy.roleId } : {}),
    ...(policy.mcpTools ? { mcpTools: policy.mcpTools } : {}),
  };
}

export async function previewRun(
  options: AgentClientOptions,
  input: PreviewTaskRequest['input'],
  commandId: string | null,
  policy: RunPolicy | null,
): Promise<RunSnapshot> {
  try {
    const previewed = await previewTask(options, {
      input,
      ...(commandId ? { commandId } : {}),
      ...(policy ? { policy: mapRunPolicy(policy) } : {}),
    });
    const snapshot = previewed.snapshot;
    return {
      command: null,
      definition: 'current',
      input: {
        text: snapshot.input.text,
        source: snapshot.input.source,
        capturedAt: snapshot.input.capturedAt,
        selection: snapshot.input.selection,
        clipboard: snapshot.input.clipboard,
        files: snapshot.input.files.map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          type: file.type,
        })),
        arguments: { ...snapshot.input.arguments },
      },
      instructions: snapshot.instructions,
      model: {
        connectionId: snapshot.model.connectionId,
        modelId: snapshot.model.modelId,
        provider: snapshot.model.provider,
        baseUrl: snapshot.model.baseUrl,
      },
      ...(snapshot.thinkingLevel ? { thinkingLevel: snapshot.thinkingLevel } : {}),
      tools: snapshot.tools.filter(
        (tool): tool is 'read' | 'write' | 'edit' | 'bash' | 'command' => tool !== 'ask_user',
      ),
      memory: snapshot.memory,
    };
  } catch (error) {
    manageError(error);
  }
}

export async function loadMemory(options: AgentClientOptions): Promise<MemorySnapshot> {
  try {
    const listed = await listMemory(options);
    return { entries: listed.entries, paused: listed.paused, error: '' };
  } catch (error) {
    return {
      entries: [],
      paused: false,
      error: error instanceof Error ? error.message : 'Memory could not be loaded.',
    };
  }
}

export async function setMemoryPaused(
  options: AgentClientOptions,
  paused: boolean,
): Promise<MemorySnapshot> {
  try {
    await pauseMemory(options, paused);
    return loadMemory(options);
  } catch (error) {
    manageError(error);
  }
}

export async function saveMemoryEntry(
  options: AgentClientOptions,
  entry: MemoryEntry,
  content: string,
): Promise<MemorySnapshot> {
  try {
    await updateMemory(options, { id: entry.id, target: entry.target }, content);
    return loadMemory(options);
  } catch (error) {
    manageError(error);
  }
}

export async function renameLiveTask(
  options: AgentClientOptions,
  taskId: string,
  title: string,
): Promise<void> {
  try {
    await patchTask(options, taskId, { title });
  } catch (error) {
    manageError(error);
  }
}

export async function retierLiveTask(
  options: AgentClientOptions,
  taskId: string,
  permissionTier: 'manual' | 'auto' | 'always',
): Promise<void> {
  try {
    await patchTask(options, taskId, { permissionTier });
  } catch (error) {
    manageError(error);
  }
}

export async function deleteLiveTask(options: AgentClientOptions, taskId: string): Promise<void> {
  try {
    await deleteTask(options, taskId);
  } catch (error) {
    manageError(error);
  }
}

export async function replaceLiveQueue(
  options: AgentClientOptions,
  taskId: string,
  followUp: string[],
): Promise<void> {
  try {
    await replaceQueue(options, taskId, followUp);
  } catch (error) {
    manageError(error);
  }
}

/** Parses `connectionId:tool` / `connectionId/tool` MCP refs; skips display-only ids. */
export function parseMcpTools(refs: string[]): { connectionId: string; tool: string }[] {
  const tools: { connectionId: string; tool: string }[] = [];
  for (const ref of refs) {
    if (ref.startsWith('mcp:tool:') || ref.startsWith('builtin:')) continue;
    const sep = ref.includes('/') ? '/' : ':';
    const index = ref.indexOf(sep);
    if (index <= 0 || index === ref.length - 1) continue;
    tools.push({ connectionId: ref.slice(0, index), tool: ref.slice(index + 1) });
  }
  return tools;
}
