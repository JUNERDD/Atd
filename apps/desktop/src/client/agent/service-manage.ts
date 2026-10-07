import {
  AgentClientError,
  compactTask,
  deleteTask,
  forkTask,
  patchTask,
  previewTask,
  replaceQueue,
  type AgentClientOptions,
} from '@atd/agent-client';
import {
  CompactRefusalSchema,
  snapshotToolsFor,
  type CompactRefusal,
  type ForkTaskRequest,
  type ForkTaskResponse,
  type PreviewTaskRequest,
  type ServiceRunPolicy,
} from '@atd/agent-contracts';
import { Value } from 'typebox/value';
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

export function mapRunPolicy(policy: RunPolicy): ServiceRunPolicy {
  return {
    tools: snapshotToolsFor(policy.tools),
    memory: policy.memory,
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

/**
 * Null once the service accepts. A refusal (409: a run is active, nothing to compact) resolves
 * to its code so the renderer words it in the interface language; other failures still throw.
 */
export async function compactLiveTask(
  options: AgentClientOptions,
  taskId: string,
  instructions: string | undefined,
): Promise<CompactRefusal | null> {
  try {
    await compactTask(options, taskId, instructions);
    return null;
  } catch (error) {
    if (
      error instanceof AgentClientError &&
      error.status === 409 &&
      Value.Check(CompactRefusalSchema, error.code)
    )
      return error.code;
    manageError(error);
  }
}

/** Forks a task at a turn; the service's refusal (an active turn, an unknown entry) is thrown. */
export async function forkLiveTask(
  options: AgentClientOptions,
  taskId: string,
  body: ForkTaskRequest,
): Promise<ForkTaskResponse> {
  try {
    return await forkTask(options, taskId, body);
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
