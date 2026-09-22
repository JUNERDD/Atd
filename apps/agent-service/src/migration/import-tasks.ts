import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  parse,
  ServiceCommandsFileSchema,
  type AgentTask,
  type RunStatus,
  type ServiceCommand,
  type ServiceCommandsFile,
  type TaskInput,
} from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';
import { Ledger } from '../ledger.js';
import { sha256 } from './checks.js';
import type { DesktopWorkspace, SourceLayout } from './sources.js';

/**
 * Tasks/commands importer: desktop workspace.json -> service ledger +
 * commands.json. Active desktop runs become `interrupted` (the source is
 * paused before migration, mirroring the desktop restart rule). Session file
 * paths are remapped to the service sessions dir; the sessions importer
 * copies the bytes. Idempotent: existing ids compare equal or conflict.
 *
 * Path (freeze candidate): `<dataDir>/commands.json`.
 */
export function commandsFile(dataDir: string): string {
  return path.join(dataDir, 'commands.json');
}

const ACTIVE = new Set([
  'queued',
  'running',
  'awaiting_input',
  'awaiting_confirmation',
  'stopping',
]);
const KNOWN_STATUS: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'awaiting_input',
  'awaiting_confirmation',
  'stopping',
  'stopped',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

const KNOWN_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'command', 'ask_user']);
const KNOWN_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const KNOWN_TIERS = new Set(['manual', 'auto', 'always']);

function mapStatus(status: string): RunStatus {
  if (ACTIVE.has(status)) return 'interrupted';
  if (KNOWN_STATUS.has(status)) return status as RunStatus;
  return 'unknown';
}

function mapInput(raw: Record<string, unknown>): TaskInput {
  return {
    text: typeof raw.text === 'string' ? raw.text.slice(0, 100000) : '',
    source:
      raw.source === 'selection' || raw.source === 'clipboard' || raw.source === 'none'
        ? raw.source
        : 'manual',
    capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : '',
    selection: typeof raw.selection === 'string' ? raw.selection.slice(0, 100000) : '',
    clipboard: typeof raw.clipboard === 'string' ? raw.clipboard.slice(0, 100000) : '',
    files: Array.isArray(raw.files)
      ? raw.files
          .filter(
            (file): file is { id: string; name: string; size: number; type: string } =>
              typeof file === 'object' &&
              file !== null &&
              typeof (file as { id?: unknown }).id === 'string',
          )
          .slice(0, 10)
          .map((file) => ({
            id: file.id.slice(0, 128),
            name: String(file.name ?? '').slice(0, 255),
            size: Number.isInteger(file.size) && file.size >= 0 ? file.size : 0,
            type: String(file.type ?? '').slice(0, 100),
          }))
      : [],
    arguments:
      typeof raw.arguments === 'object' && raw.arguments !== null
        ? (raw.arguments as Record<string, string | number | boolean>)
        : {},
  };
}

function mapModel(raw: Record<string, unknown>): AgentTask['runs'][number]['snapshot']['model'] {
  const provider =
    typeof raw.provider === 'string' && raw.provider ? raw.provider : 'openai-compatible';
  const model: AgentTask['runs'][number]['snapshot']['model'] = {
    connectionId:
      typeof raw.connectionId === 'string' ? raw.connectionId.slice(0, 4096) : 'migrated',
    modelId:
      typeof raw.modelId === 'string' && raw.modelId ? raw.modelId.slice(0, 256) : 'migrated-model',
    provider: provider.slice(0, 256),
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.slice(0, 2048) : '',
  };
  if (typeof raw.configurationId === 'string' && raw.configurationId)
    model.configurationId = raw.configurationId.slice(0, 256);
  return model;
}

export function mapDesktopTask(
  task: DesktopWorkspace['tasks'][number],
  layout: SourceLayout,
  serviceSessionsDir: string,
): AgentTask {
  return {
    id: task.id,
    title: task.title,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    sessionFile: task.sessionFile
      ? remapSessionFile(task.sessionFile, layout, serviceSessionsDir)
      : null,
    runs: task.runs.map((run) => {
      const snapshot = run.snapshot as unknown as Record<string, unknown>;
      const tools = Array.isArray(snapshot.tools)
        ? [
            ...new Set(
              (snapshot.tools as unknown[]).filter(
                (tool): tool is string => typeof tool === 'string' && KNOWN_TOOLS.has(tool),
              ),
            ),
          ]
        : [];
      const level = typeof snapshot.thinkingLevel === 'string' ? snapshot.thinkingLevel : 'off';
      return {
        id: run.id,
        operationId: run.invocationId,
        createdAt: run.createdAt,
        status: mapStatus(run.status),
        error: ACTIVE.has(run.status)
          ? 'Interrupted by migration: the desktop source was paused before import.'
          : run.error,
        snapshot: {
          input: mapInput((snapshot.input ?? {}) as Record<string, unknown>),
          instructions:
            typeof snapshot.instructions === 'string' ? snapshot.instructions.slice(0, 20000) : '',
          model: mapModel((snapshot.model ?? {}) as Record<string, unknown>),
          tools: tools as AgentTask['runs'][number]['snapshot']['tools'],
          memory: snapshot.memory === true,
          ...(KNOWN_LEVELS.has(level) ? { thinkingLevel: level as 'off' } : {}),
        },
      };
    }),
    rootTaskId: null,
    parentExecutionId: null,
    ...(typeof task.permissionTier === 'string' && KNOWN_TIERS.has(task.permissionTier)
      ? { permissionTier: task.permissionTier as 'manual' }
      : {}),
  };
}

/** Rewrites a desktop session path to the service sessions dir by file name. */
export function remapSessionFile(
  desktopFile: string,
  layout: SourceLayout,
  serviceSessionsDir: string,
): string {
  const base = path.basename(desktopFile);
  const dir = path.basename(path.dirname(desktopFile));
  const taskDir = desktopFile.startsWith(layout.sessionsDir + path.sep) ? dir : 'migrated';
  return path.join(serviceSessionsDir, taskDir, base);
}

export function mapDesktopCommand(
  command: DesktopWorkspace['commands'][number],
  at: string,
): ServiceCommand {
  return {
    ...(command as unknown as Record<string, string | number | boolean | string[]>),
    id: command.id,
    revision: command.revision,
    name: command.name.slice(0, 120),
    description: command.description.slice(0, 500),
    instructions: command.instructions.slice(0, 20000),
    enabled: command.enabled,
    tools: command.tools.map((tool) => tool.slice(0, 64)).slice(0, 20),
    memory: command.memory === 'off' ? 'off' : 'inherit',
    migratedAt: at,
  } as ServiceCommand;
}

export async function loadCommandsFile(dataDir: string): Promise<ServiceCommandsFile> {
  const file = commandsFile(dataDir);
  try {
    if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error('Commands file is too large.');
    return parse(ServiceCommandsFileSchema, JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { version: 1, commands: [] };
    throw new Error('Saved service commands could not be read. The file is preserved.');
  }
}

/** Imports tasks into the ledger; returns per-task inserted/identical flags. */
export async function importTasks(
  ledger: Ledger,
  workspace: DesktopWorkspace,
  layout: SourceLayout,
  serviceSessionsDir: string,
): Promise<{ inserted: number; identical: number }> {
  const mapped = workspace.tasks.map((task) => mapDesktopTask(task, layout, serviceSessionsDir));
  return ledger.change((draft) => {
    let inserted = 0;
    let identical = 0;
    for (const task of mapped) {
      const existing = draft.tasks.find((item) => item.id === task.id);
      if (!existing) {
        draft.tasks.unshift(task);
        for (const run of task.runs)
          draft.operations[run.operationId] = { taskId: task.id, runId: run.id };
        inserted += 1;
        continue;
      }
      if (sha256(JSON.stringify(existing)) !== sha256(JSON.stringify(task)))
        throw new Error(`Task ${task.id} diverged since migration; refusing to overwrite.`);
      for (const run of task.runs)
        draft.operations[run.operationId] ??= { taskId: task.id, runId: run.id };
      identical += 1;
    }
    return { inserted, identical };
  });
}

/** Imports commands into commands.json idempotently. */
export async function importCommands(
  dataDir: string,
  workspace: DesktopWorkspace,
  at: string,
): Promise<{ inserted: number; identical: number }> {
  const file = loadCommandsFile(dataDir);
  const current = await file;
  let inserted = 0;
  let identical = 0;
  const next: ServiceCommand[] = [...current.commands];
  for (const command of workspace.commands) {
    const mapped = mapDesktopCommand(command, at);
    const index = next.findIndex((item) => item.id === mapped.id);
    if (index < 0) {
      next.push(mapped);
      inserted += 1;
      continue;
    }
    const { migratedAt: _a, ...kept } = next[index] as unknown as Record<string, unknown>;
    const { migratedAt: _b, ...fresh } = mapped as unknown as Record<string, unknown>;
    if (sha256(JSON.stringify(kept)) !== sha256(JSON.stringify(fresh)))
      throw new Error(`Command ${mapped.id} diverged since migration; refusing to overwrite.`);
    identical += 1;
  }
  await atomicWrite(
    commandsFile(dataDir),
    parse(ServiceCommandsFileSchema, { version: 1, commands: next }),
  );
  return { inserted, identical };
}
