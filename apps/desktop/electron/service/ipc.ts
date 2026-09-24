import type { BuiltinStatusWire } from '@ai/agent-client';
import { Type, type Static } from 'typebox';

export const ServiceStateSchema = Type.Union([
  Type.Literal('disconnected'),
  Type.Literal('connecting'),
  Type.Literal('connected'),
  Type.Literal('reconnecting'),
]);
export type ServiceState = Static<typeof ServiceStateSchema>;

/** Connection + liveness mirrored from /v1/status; no token ever crosses IPC. */
export interface ServiceStatusView {
  state: ServiceState;
  detail: string;
  serviceId: string | null;
  epoch: number | null;
  draining: boolean;
  activeRuns: number;
  pendingConfirms: number;
  pendingCapabilities: number;
  dataDir: string | null;
  baseUrl: string | null;
  stream: { epoch: number; seq: number };
}

const RoleToolSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('write'),
  Type.Literal('edit'),
  Type.Literal('bash'),
  Type.Literal('command'),
]);

const RoleIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
});

const SkillNameSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
});

/** Built-in resource id (`skill:<name>` or `role:<id>`), checked before it reaches the service URL. */
const BuiltinIdSchema = Type.String({
  minLength: 1,
  maxLength: 134,
  pattern: '^(skill|role):[A-Za-z0-9][A-Za-z0-9_-]{0,127}$',
});

const McpAuthDraftSchema = Type.Union([
  Type.Object({ type: Type.Literal('none') }, { additionalProperties: false }),
  Type.Object(
    {
      type: Type.Literal('bearer'),
      tokenEnv: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal('oauth') }, { additionalProperties: false }),
]);

export const ServiceRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('status') }),
  Type.Object({
    action: Type.Literal('connect'),
    dataDir: Type.String({ minLength: 1, maxLength: 2048 }),
  }),
  Type.Object({ action: Type.Literal('disconnect') }),
  Type.Object({
    action: Type.Literal('startLocal'),
    dataDir: Type.String({ minLength: 1, maxLength: 2048 }),
    port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  }),
  Type.Object({ action: Type.Literal('skills') }),
  Type.Object({
    action: Type.Literal('skillsUpdate'),
    name: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    action: Type.Literal('skillsSetEnabled'),
    name: Type.String({ minLength: 1, maxLength: 128 }),
    enabled: Type.Boolean(),
  }),
  Type.Object({
    action: Type.Literal('skillsInstall'),
    source: Type.String({ minLength: 1, maxLength: 2048 }),
    sourceKind: Type.Union([Type.Literal('local'), Type.Literal('npm'), Type.Literal('git')]),
    name: Type.Optional(SkillNameSchema),
  }),
  Type.Object({ action: Type.Literal('builtinRestore'), id: BuiltinIdSchema }),
  Type.Object({ action: Type.Literal('roles') }),
  Type.Object({
    action: Type.Literal('rolesPut'),
    id: RoleIdSchema,
    title: Type.String({ minLength: 1, maxLength: 256 }),
    allows: Type.Object(
      {
        tools: Type.Array(RoleToolSchema, { maxItems: 16 }),
        skills: Type.Array(SkillNameSchema, { maxItems: 128 }),
      },
      { additionalProperties: false },
    ),
  }),
  Type.Object({ action: Type.Literal('agents') }),
  Type.Object({
    action: Type.Literal('agentsPut'),
    name: SkillNameSchema,
    description: Type.String({ minLength: 1, maxLength: 2048 }),
    tools: Type.Array(RoleToolSchema, { maxItems: 16 }),
    model: Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
    systemPrompt: Type.String({ minLength: 1, maxLength: 16000 }),
  }),
  Type.Object({ action: Type.Literal('mcpStatus') }),
  Type.Object({
    action: Type.Literal('mcpConnect'),
    serverId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    action: Type.Literal('mcpAuthStart'),
    serverId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    action: Type.Literal('mcpAuthComplete'),
    serverId: Type.String({ minLength: 1, maxLength: 128 }),
    input: Type.String({ minLength: 1, maxLength: 8192 }),
  }),
  Type.Object({
    action: Type.Literal('mcpUpsert'),
    serverId: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: '^[a-zA-Z0-9_-]+$',
    }),
    transport: Type.Union([
      Type.Literal('stdio'),
      Type.Literal('streamable-http'),
      Type.Literal('sse'),
    ]),
    command: Type.Optional(Type.String({ maxLength: 1024 })),
    args: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 })),
    url: Type.Optional(Type.String({ maxLength: 2048 })),
    auth: McpAuthDraftSchema,
  }),
  Type.Object({
    action: Type.Literal('mcpDisable'),
    serverId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  Type.Object({
    action: Type.Literal('mcpRemove'),
    serverId: Type.String({ minLength: 1, maxLength: 128 }),
  }),
]);
export type ServiceRequest = Static<typeof ServiceRequestSchema>;

export type ServiceEvent =
  | { type: 'status'; status: ServiceStatusView }
  | { type: 'notice'; text: string; kind: 'info' | 'warning' | 'error' };

export interface ServiceBridge {
  status: () => Promise<ServiceStatusView>;
  connect: (dataDir: string) => Promise<ServiceStatusView>;
  disconnect: () => Promise<ServiceStatusView>;
  startLocal: (dataDir: string, port?: number) => Promise<ServiceStatusView>;
  skills: () => Promise<{ skills: unknown[]; diagnostics: unknown[] }>;
  updateSkill: (name: string) => Promise<{ skill: unknown; diagnostics: unknown[] }>;
  setSkillEnabled: (name: string, enabled: boolean) => Promise<{ name: string; enabled: boolean }>;
  installSkill: (input: {
    source: string;
    sourceKind: 'local' | 'npm' | 'git';
    name?: string;
  }) => Promise<{ skill: unknown; diagnostics: unknown[] }>;
  /** Backs up the user's copy of a built-in resource, then reinstalls the shipped version. */
  restoreBuiltin: (id: string) => Promise<{
    id: string;
    /** Where the replaced copy was saved; null when there was no copy to back up. */
    backupPath: string | null;
    builtin: BuiltinStatusWire;
  }>;
  roles: () => Promise<{ roles: unknown[] }>;
  putRole: (input: {
    id: string;
    title: string;
    allows: {
      tools: Array<'read' | 'write' | 'edit' | 'bash' | 'command'>;
      skills: string[];
    };
  }) => Promise<{ role: unknown }>;
  agents: () => Promise<{ agents: unknown[] }>;
  putAgent: (input: {
    name: string;
    description: string;
    tools: Array<'read' | 'write' | 'edit' | 'bash' | 'command'>;
    model: string | null;
    systemPrompt: string;
  }) => Promise<{ agent: unknown }>;
  mcpStatus: () => Promise<{ servers: unknown[] }>;
  mcpConnect: (serverId: string) => Promise<{ ok: boolean }>;
  mcpAuthStart: (serverId: string) => Promise<{
    serverId: string;
    authenticated: boolean;
    authorizationUrl: string | null;
    mode: string;
  }>;
  mcpAuthComplete: (serverId: string, input: string) => Promise<{ ok: boolean }>;
  mcpUpsert: (input: {
    serverId: string;
    transport: 'stdio' | 'streamable-http' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    auth: { type: 'none' } | { type: 'bearer'; tokenEnv: string } | { type: 'oauth' };
  }) => Promise<{ servers: unknown[] }>;
  mcpDisable: (serverId: string) => Promise<{ servers: unknown[] }>;
  mcpRemove: (serverId: string) => Promise<{ servers: unknown[] }>;
  onChange: (listener: (event: ServiceEvent) => void) => () => void;
}
