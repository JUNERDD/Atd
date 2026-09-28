import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { parse } from '@ai/agent-contracts';
import { servicePaths } from '../storage.js';
import {
  assertStable,
  assertUnderLimit,
  MAX_SETTINGS_BYTES,
  MAX_WORKSPACE_BYTES,
  sha256,
} from './checks.js';

/**
 * Desktop source layout (read-only; the service never writes here):
 * - `<userData>/agent-v1/workspace.json` tasks/commands/artifacts/memoryPaused
 * - `<userData>/agent-v1/resources.json` + `attachments/<id>/<name>`
 * - `<userData>/agent-v1/agent/sessions/<taskId>/` + session JSONL files
 * - `<userData>/agent-v1/agent/pi-hermes-memory/` MEMORY/USER/sessions.db*
 * - `<userData>/agent-v1/tasks/<taskId>/output/`
 * - `<userData>/settings.json` provider connections + permissionTier
 * - `<userData>/providers/<connectionId>/` SDK catalog caches (not migrated)
 */

export interface SourceLayout {
  root: string;
  agentV1: string;
  workspaceFile: string;
  resourcesFile: string;
  attachmentsDir: string;
  agentDir: string;
  sessionsDir: string;
  memoryDir: string;
  tasksDir: string;
  settingsFile: string;
}

export function sourceLayout(userDataRoot: string): SourceLayout {
  const agentV1 = path.join(userDataRoot, 'agent-v1');
  const agentDir = path.join(agentV1, 'agent');
  return {
    root: userDataRoot,
    agentV1,
    workspaceFile: path.join(agentV1, 'workspace.json'),
    resourcesFile: path.join(agentV1, 'resources.json'),
    attachmentsDir: path.join(agentV1, 'attachments'),
    agentDir,
    sessionsDir: path.join(agentDir, 'sessions'),
    memoryDir: path.join(agentDir, 'pi-hermes-memory'),
    tasksDir: path.join(agentV1, 'tasks'),
    settingsFile: path.join(userDataRoot, 'settings.json'),
  };
}

const Identifier = Type.String({ minLength: 1, maxLength: 128 });

const DesktopRunSnapshotSchema = Type.Object(
  {
    command: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
    definition: Type.Union([Type.Literal('current'), Type.Literal('saved')]),
    input: Type.Object({}, { additionalProperties: true }),
    instructions: Type.String(),
    model: Type.Object({}, { additionalProperties: true }),
    thinkingLevel: Type.Optional(Type.String()),
    tools: Type.Array(Type.String()),
    memory: Type.Boolean(),
  },
  { additionalProperties: true },
);

const DesktopRunSchema = Type.Object(
  {
    id: Identifier,
    invocationId: Identifier,
    createdAt: Type.String(),
    status: Type.String(),
    error: Type.String(),
    snapshot: DesktopRunSnapshotSchema,
  },
  { additionalProperties: true },
);

const DesktopTaskSchema = Type.Object(
  {
    id: Identifier,
    title: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    sessionFile: Type.Union([Type.String(), Type.Null()]),
    runs: Type.Array(DesktopRunSchema),
    legacy: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
    permissionTier: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

const DesktopCommandSchema = Type.Object(
  {
    id: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    name: Type.String(),
    description: Type.String(),
    instructions: Type.String(),
    enabled: Type.Boolean(),
    tools: Type.Array(Type.String()),
    memory: Type.String(),
  },
  { additionalProperties: true },
);

export const DesktopWorkspaceSchema = Type.Object(
  {
    version: Type.Literal(1),
    commands: Type.Array(DesktopCommandSchema),
    tasks: Type.Array(DesktopTaskSchema),
    artifacts: Type.Array(Type.Object({}, { additionalProperties: true })),
    /** Written by older desktops only; newer ones dropped the field, which reads as not paused. */
    memoryPaused: Type.Optional(Type.Boolean()),
    legacyImported: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type DesktopWorkspace = Static<typeof DesktopWorkspaceSchema>;

const DesktopConnectionSchema = Type.Object(
  {
    connectionId: Identifier,
    provider: Type.String(),
    name: Type.String(),
    baseUrl: Type.String(),
    authType: Type.String(),
    defaultModel: Type.String(),
    options: Type.Record(Type.String(), Type.String()),
    customModels: Type.Array(Type.Object({}, { additionalProperties: true })),
    revision: Type.Integer({ minimum: 1 }),
    connected: Type.Boolean(),
    encryptedCredential: Type.String(),
    catalog: Type.Array(Type.Object({}, { additionalProperties: true })),
    catalogError: Type.String(),
    verifiedModel: Type.String(),
  },
  { additionalProperties: true },
);

export const DesktopSettingsSchema = Type.Object(
  {
    version: Type.Literal(2),
    connections: Type.Array(DesktopConnectionSchema),
    defaultConnectionId: Type.Union([Identifier, Type.Null()]),
    permissionTier: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type DesktopSettings = Static<typeof DesktopSettingsSchema>;

const DesktopResourceSchema = Type.Object(
  {
    file: Type.Object(
      {
        id: Identifier,
        name: Type.String(),
        size: Type.Integer({ minimum: 0 }),
        type: Type.String(),
      },
      { additionalProperties: true },
    ),
    source: Type.String(),
    managed: Type.String(),
    fingerprint: Type.String(),
    owners: Type.Array(Type.String()),
  },
  { additionalProperties: true },
);

export const DesktopResourcesSchema = Type.Object(
  {
    version: Type.Literal(1),
    resources: Type.Array(DesktopResourceSchema),
  },
  { additionalProperties: false },
);
export type DesktopResources = Static<typeof DesktopResourcesSchema>;

export async function loadWorkspace(layout: SourceLayout): Promise<DesktopWorkspace> {
  await assertUnderLimit(layout.workspaceFile, MAX_WORKSPACE_BYTES);
  await assertStable(layout.workspaceFile);
  return parse(DesktopWorkspaceSchema, JSON.parse(await readFile(layout.workspaceFile, 'utf8')));
}

export async function loadSettings(layout: SourceLayout): Promise<DesktopSettings> {
  await assertUnderLimit(layout.settingsFile, MAX_SETTINGS_BYTES);
  await assertStable(layout.settingsFile);
  return parse(DesktopSettingsSchema, JSON.parse(await readFile(layout.settingsFile, 'utf8')));
}

export async function loadResourcesIndex(layout: SourceLayout): Promise<DesktopResources> {
  try {
    return parse(DesktopResourcesSchema, JSON.parse(await readFile(layout.resourcesFile, 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { version: 1, resources: [] };
    throw new Error('Desktop attachment index could not be read.');
  }
}

export interface SourceDocs {
  workspace: DesktopWorkspace;
  settings: DesktopSettings | null;
  workspaceChecksum: string;
}

export function emptyWorkspace(): DesktopWorkspace {
  return {
    version: 1,
    commands: [],
    tasks: [],
    artifacts: [],
    legacyImported: false,
  };
}

/** Reads the initialized service identity; migration never invents one. */
export async function readServiceId(dataDir: string): Promise<string> {
  const paths = servicePaths(path.resolve(dataDir));
  try {
    const file = JSON.parse(await readFile(paths.serviceFile, 'utf8')) as { serviceId?: unknown };
    if (typeof file.serviceId !== 'string' || !file.serviceId) throw new Error('bad identity');
    return file.serviceId;
  } catch {
    throw new Error('Run `serve` once to initialize the service identity before migrating.');
  }
}

/** Loads workspace/settings tolerantly: missing files mean empty domains. */
export async function loadSourceDocs(
  sourceRoot: string,
): Promise<{ layout: SourceLayout; docs: SourceDocs }> {
  const layout = sourceLayout(path.resolve(sourceRoot));
  let workspace = emptyWorkspace();
  let workspaceChecksum = sha256('empty-workspace');
  try {
    workspace = await loadWorkspace(layout);
    workspaceChecksum = sha256(
      JSON.stringify({ tasks: workspace.tasks, commands: workspace.commands }),
    );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  let settings: DesktopSettings | null = null;
  try {
    settings = await loadSettings(layout);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return { layout, docs: { workspace, settings, workspaceChecksum } };
}

/** Reads desktop pause/flush markers, or requires an explicit quiesced claim. */
export async function readPauseMarkers(
  sourceRoot: string,
  assumeQuiesced: boolean,
): Promise<{ pausedAt: string | null; flushedAt: string | null }> {
  const readMarker = async (name: string): Promise<string | null> => {
    try {
      const marker = JSON.parse(await readFile(path.join(sourceRoot, name), 'utf8')) as {
        at?: unknown;
      };
      return typeof marker.at === 'string' ? marker.at : null;
    } catch {
      return null;
    }
  };
  const pausedAt = await readMarker('migration-paused.json');
  const flushedAt = await readMarker('migration-flushed.json');
  if (!pausedAt || !flushedAt) {
    if (!assumeQuiesced)
      throw new Error(
        'Desktop pause/flush markers are missing; pause the desktop first or pass --assume-quiesced for an isolated copy.',
      );
    return { pausedAt: null, flushedAt: null };
  }
  return { pausedAt, flushedAt };
}
