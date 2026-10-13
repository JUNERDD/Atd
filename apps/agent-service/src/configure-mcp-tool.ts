import { Type, type Static } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  CONFIGURE_MCP_TOOL,
  LIST_MCP_TOOL,
  McpServerUpsertRequestSchema,
  parse,
  type McpConnectionState,
  type McpLaunchApprovalState,
  type McpServerConfig,
  type McpServerUpsertRequest,
} from '@atd/agent-contracts';
import type { Gate } from './harness/gate.js';
import { serverView } from './mcp/server-edits.js';
import { servicePaths } from './storage.js';
import { auditUnattended, UNATTENDED_MCP_CONFIG } from './unattended.js';

/** A saved server and whether it may launch as saved (mcp/launch-approvals.ts). */
export interface ConfiguredMcp {
  record: McpServerConfig;
  approval: McpLaunchApprovalState;
}

/**
 * The authority's upsert (mcp/authority.ts), which merges and checks the edit. `created` says no
 * server had the id before it.
 */
export type UpsertMcp = (
  serverId: string,
  request: McpServerUpsertRequest,
) => Promise<ConfiguredMcp & { created: boolean }>;

/** The user's servers (mcp/authority.ts `configured`) with their approval and connection state. */
export type ListMcp = () => Promise<(ConfiguredMcp & { state: McpConnectionState })[]>;

export interface ConfigureMcpHost {
  upsertMcp?: UpsertMcp;
  listMcp?: ListMcp;
  audit: (entry: Record<string, unknown>) => void;
  taskId: string;
  runId: () => string;
}

/**
 * The saved server, whether the call created it (the turn's artifact card,
 * transcript-details/artifact.ts) and, while it waits for the user's launch approval, which
 * approval (transcript-details/mcp-approval.ts); empty when nothing was saved.
 */
type ConfigureMcpDetails =
  | Record<string, never>
  | { serverId: string; created: boolean; approval?: 'required' | 'changed' };

/**
 * What the model sees of a server: the settings `configure_mcp` takes, the names (never the
 * values) of its env vars and headers, and whether it may run. Connection ids and pool settings
 * stay out; nothing the model sees here needs a file read to confirm.
 */
function modelView(
  record: McpServerConfig,
  approval: McpLaunchApprovalState,
  state?: McpConnectionState,
) {
  const { stdio, http } = record;
  return {
    serverId: record.serverId,
    transport: record.transport,
    ...(stdio
      ? { command: stdio.command, args: stdio.args, envNames: Object.keys(stdio.env) }
      : {}),
    // The view's auth: an OAuth client secret only as `{ set: true }`, never its value.
    ...(http
      ? {
          url: http.url,
          headerNames: Object.keys(http.headers),
          auth: serverView(record).http?.auth,
        }
      : {}),
    revision: record.revision,
    disabled: record.disabled,
    approval,
    ...(state ? { state } : {}),
  };
}

const request = McpServerUpsertRequestSchema.properties;

/**
 * Auth as the model may set it: an OAuth server keeps its stored client. A pre-registered client
 * and its authorization server decide where sign-in codes, tokens and the client secret go, so
 * only the user sets them (`McpOAuthClientDraftSchema`, in Settings).
 */
const ModelAuthSchema = Type.Union([
  Type.Object({ type: Type.Literal('none') }, { additionalProperties: false }),
  Type.Object(
    { type: Type.Literal('bearer'), tokenEnv: Type.String({ minLength: 1, maxLength: 256 }) },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal('oauth') }, { additionalProperties: false }),
]);

/**
 * An upsert without `env`, `headers`, an OAuth client, `exposure` or `exposeResources`: the model
 * never sets or sees secret values, and leaving these out keeps the stored ones (see
 * `McpServerUpsertRequestSchema`). How tools and resources reach the model is the user's setting.
 */
const DraftSchema = Type.Object(
  {
    serverId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
    transport: request.transport,
    command: request.command,
    args: request.args,
    url: request.url,
    auth: ModelAuthSchema,
  },
  { additionalProperties: false },
);
type Draft = Omit<Static<typeof DraftSchema>, 'serverId'>;

/** The approval gate (harness/gate.ts) and the `configure_mcp` call it confirms. */
export interface ConfigureMcpConfirm {
  gate: Gate;
  toolCallId: string;
  signal?: AbortSignal | undefined;
}

/** Where a server connects and how it signs in: a draft, or a saved record's settings. */
interface Endpoint {
  transport: McpServerConfig['transport'];
  command?: string | undefined;
  args?: readonly string[] | undefined;
  url?: string | undefined;
  auth: { type: 'none' } | { type: 'bearer'; tokenEnv: string } | { type: 'oauth' };
}

const TRANSPORTS: Record<Endpoint['transport'], string> = {
  stdio: 'local command (stdio)',
  'streamable-http': 'Streamable HTTP',
  sse: 'HTTP with Server-Sent Events',
};

function authText(auth: Endpoint['auth']): string {
  switch (auth.type) {
    case 'none':
      return 'none';
    case 'bearer':
      return auth.tokenEnv
        ? `bearer token read from the environment variable ${auth.tokenEnv}, which you set yourself; the agent never sees its value`
        : 'bearer token from the system credential store';
    case 'oauth':
      return 'OAuth: you sign in from Settings › Extensions after saving';
  }
}

/** The endpoint as the user reads it; an argument with spaces, or an empty one, is quoted. */
function endpointLines({ transport, command, args = [], url, auth }: Endpoint): string[] {
  if (transport !== 'stdio')
    return [`Transport: ${TRANSPORTS[transport]}`, `URL: ${url}`, `Auth: ${authText(auth)}`];
  const quoted = args.map((arg) => (/^\S+$/.test(arg) ? arg : JSON.stringify(arg)));
  return [`Transport: ${TRANSPORTS[transport]}`, `Command: ${[command, ...quoted].join(' ')}`];
}

/**
 * What the user approves before `configure_mcp` saves (English, like every confirm detail the
 * service writes): whether it adds or changes the server, where it connects and how it signs in,
 * and for a change the settings it replaces. Env vars and headers never appear: the model sets
 * none, and an update keeps the stored ones.
 */
function confirmDetail(serverId: string, draft: Draft, current: McpServerConfig | undefined) {
  const head = current
    ? `Changes the MCP server "${serverId}" the agent uses.`
    : `Adds the MCP server "${serverId}" for the agent to use.`;
  const lines = [head, ...endpointLines(draft)];
  if (!current) return lines.join('\n');
  const was = endpointLines({
    transport: current.transport,
    command: current.stdio?.command,
    args: current.stdio?.args,
    url: current.http?.url,
    auth: current.http?.auth ?? { type: 'none' },
  });
  return [...lines, 'Replaces:', ...was.map((line) => `  ${line}`)].join('\n');
}

/**
 * Runs one `configure_mcp` call once the user approves it. Every save asks (`askAlways`): a saved
 * server runs later in any task, and the `auto` tier's review cannot judge whether the user wants
 * it; a decline throws the gate's message and saves nothing. The answer is a status only: the
 * saved record holds env and header values, which must never reach the model or the transcript. A
 * server that runs a local command or reads a service env var cannot run until the user approves
 * its launch as well, which the model cannot do; the answer says so instead of letting a later
 * call fail unexplained, and its details name the server so the transcript can offer the approval
 * (transcript-details/mcp-approval.ts).
 */
export async function configureMcp(
  host: ConfigureMcpHost,
  args: unknown,
  confirm: ConfigureMcpConfirm,
): Promise<{
  content: { type: 'text'; text: string }[];
  details: ConfigureMcpDetails;
}> {
  if (!host.upsertMcp || !host.listMcp) {
    return {
      content: [
        {
          type: 'text',
          text: 'MCP configuration is unavailable because the MCP authority is not loaded for this run.',
        },
      ],
      details: {},
    };
  }
  const { serverId, ...draft } = parse(DraftSchema, args);
  const current = (await host.listMcp()).find(({ record }) => record.serverId === serverId);
  await confirm.gate({
    toolCallId: confirm.toolCallId,
    // The scope of MCP confirms, which never become a session grant (mcp/approval.ts).
    scope: { tool: 'mcp' },
    title: `${current ? 'Change' : 'Add'} the MCP server "${serverId}"?`,
    detail: confirmDetail(serverId, draft, current?.record),
    signal: confirm.signal,
    askAlways: true,
    declinedMessage: `The user declined saving the MCP server "${serverId}", so nothing was saved. Ask what they want changed instead of retrying the same settings.`,
  });
  const { record: saved, approval, created } = await host.upsertMcp(serverId, draft);
  host.audit({
    taskId: host.taskId,
    runId: host.runId(),
    tool: CONFIGURE_MCP_TOOL,
    decision: 'applied',
    serverId,
  });
  const content = [{ type: 'text' as const, text: JSON.stringify(modelView(saved, approval)) }];
  if (approval !== 'required' && approval !== 'changed')
    return { content, details: { serverId, created } };
  const why =
    approval === 'required'
      ? 'runs a local command or reads a service environment variable, so it cannot run until the user approves it'
      : 'changed since the user approved it, so it cannot run until the user approves it again';
  content.push({
    type: 'text' as const,
    text: `MCP server ${serverId} ${why}. The app shows the user an approval banner under this step; they can also approve it in Settings › Extensions. Tell the user; you cannot approve it.`,
  });
  return { content, details: { serverId, created, approval } };
}

/**
 * Refuses one `configure_mcp` call of an unattended run (unattended.ts): nobody is present to
 * review a server change, and a saved server can run later without anyone approving it.
 */
async function refuseUnattended(host: ConfigureMcpHost, args: unknown): Promise<never> {
  const serverId =
    typeof args === 'object' &&
    args !== null &&
    'serverId' in args &&
    typeof args.serverId === 'string'
      ? args.serverId
      : '';
  auditUnattended(host.audit, {
    taskId: host.taskId,
    runId: host.runId(),
    tool: CONFIGURE_MCP_TOOL,
    kind: 'mcpConfig',
    title: `Configure MCP server ${serverId}`.trim(),
  });
  throw new Error(UNATTENDED_MCP_CONFIG);
}

/** Runs one `list_mcp_servers` call: the user's servers as the model sees them. */
export async function listMcpServers(host: ConfigureMcpHost) {
  const text = host.listMcp
    ? JSON.stringify(
        (await host.listMcp()).map(({ record, approval, state }) =>
          modelView(record, approval, state),
        ),
      )
    : 'MCP servers are unavailable because the MCP authority is not loaded for this run.';
  return { content: [{ type: 'text' as const, text }], details: {} };
}

/**
 * Registers the parent-run MCP catalog tools: `list_mcp_servers` reads the user's servers and
 * `configure_mcp` upserts one, so the model never needs the catalog files. The client declares no
 * MCP roots (the capability is deprecated as of MCP 2026-07-28, SEP-2577, and a connection is
 * shared by every task), so the description names the tasks folder for a server's own
 * file-access option instead. `configure_mcp` asks the user through `gate` before every save and
 * is unavailable in an unattended run.
 */
export function registerMcpCatalogTools(
  pi: ExtensionAPI,
  host: ConfigureMcpHost & { dataDir: string; unattended: () => boolean },
  gate: Gate,
): void {
  const { tasksDir } = servicePaths(host.dataDir);
  pi.registerTool({
    name: LIST_MCP_TOOL,
    label: 'List MCP servers',
    description:
      'List the MCP servers the user configured, the ones configure_mcp adds and updates: each ' +
      "server's settings with the names but never the values of its env vars and headers, " +
      'whether it is disabled, its launch approval and its connection state. Read it before ' +
      'adding a server, to avoid a duplicate, and before updating one, to start from its current ' +
      'settings. Servers from installed plugins are not listed.',
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: () => listMcpServers(host),
  });
  pi.registerTool({
    name: CONFIGURE_MCP_TOOL,
    label: 'Configure MCP server',
    description:
      'Add or update one MCP server in the service catalog. This tool is the only way to change ' +
      'MCP servers and writes the catalog itself, creating it when none exists; its result shows ' +
      'what was saved, and list_mcp_servers shows what is configured. Neither needs the ' +
      'configuration files, so never look for, read or edit them. ' +
      'Every call first asks the user to approve the settings it saves, so do not ask them ' +
      'again; when they decline, nothing is saved. ' +
      "A stdio command runs with the user's login-shell PATH, so name it as the server's " +
      'documentation does (for example npx) rather than by an absolute or version-specific path. ' +
      'An update replaces the transport, command/args or url, and auth of that serverId; it keeps ' +
      "the server's stored environment variables and headers, which the result never shows, and " +
      'refuses a change that would send them to another command or URL origin. ' +
      'A new or changed server that runs a local command, or whose token, URL or headers read ' +
      'a service environment variable, cannot run until the user approves it from the approval ' +
      'banner the app shows in the task or in Settings › Extensions; you cannot approve it. ' +
      'This app declares no MCP roots, and one connection serves every task. A server that only ' +
      'reads or writes files inside configured directories (for example a --workspace option) ' +
      `needs that option set to ${tasksDir}, which holds every task folder, as one args entry ` +
      `such as --workspace=${tasksDir}; never pass an option that lifts its path restriction.`,
    parameters: DraftSchema,
    executionMode: 'sequential',
    // The launch approval banner reads the call's persisted result, which a nested call never has.
    exposure: 'model-only',
    execute: (toolCallId, args, signal) =>
      host.unattended()
        ? refuseUnattended(host, args)
        : configureMcp(host, args, { gate, toolCallId, signal }),
  });
}
