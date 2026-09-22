import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

/**
 * Structural mirrors of the adapter/MCP shapes the service touches. No
 * static adapter or MCP import lives here; narrowing happens at call sites.
 */

export type AdapterModuleSource = 'env-override' | 'bare-specifier' | 'workspace-desktop';

/** Structural mirror of the adapter ServerEntry fields the service sets. */
export interface AdapterServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  inheritEnv?: boolean;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: 'oauth' | 'bearer' | false;
  bearerToken?: string;
  bearerTokenEnv?: string;
  oauth?: { scope?: string; redirectUri?: string; clientName?: string } | false;
  lifecycle?: 'keep-alive' | 'lazy' | 'lazy-keep-alive' | 'eager';
  idleTimeout?: number;
  requestTimeoutMs?: number;
  exposeResources?: boolean;
  directTools?: boolean | string[];
  toolPrefix?: 'server' | 'none' | 'short' | 'mcp';
  includeTools?: string[];
  excludeTools?: string[];
  approveTools?: boolean | string[];
  httpTransport?: 'streamable-http' | 'sse';
  protocolVersion?: 'legacy' | 'auto' | '2026-07-28';
  disabled?: boolean;
}

export interface AdapterMcpSettings {
  toolPrefix?: 'server' | 'none' | 'short' | 'mcp';
  directTools?: boolean | 'search';
  scriptMode?: boolean;
  approveTools?: boolean | string[];
  disableProxyTool?: boolean;
  autoAuth?: boolean;
  sampling?: boolean;
  samplingAutoApprove?: boolean;
  elicitation?: boolean;
  outputGuard?: boolean;
}

export interface AdapterMcpConfig {
  mcpServers: Record<string, AdapterServerEntry>;
  settings?: AdapterMcpSettings;
}

export interface AdapterOptions {
  config?: AdapterMcpConfig;
  configPath?: string;
}

export type AdapterFactory = (options: AdapterOptions) => ExtensionFactory;

export interface AdapterProgress {
  progress: number;
  total?: number;
  message?: string;
}

export interface AdapterRequestOptions {
  signal?: AbortSignal;
  onprogress?: (progress: AdapterProgress) => void;
  timeout?: number;
}

export interface AdapterToolDef {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  _meta?: unknown;
}

export interface AdapterResourceDef {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  _meta?: unknown;
}

export interface AdapterResourceTemplateDef {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  _meta?: unknown;
}

export interface AdapterPromptDef {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  _meta?: unknown;
}

/** Structural subset of the MCP Client the adapter owns per connection. */
export interface AdapterClientLike {
  listTools(
    params?: unknown,
    options?: AdapterRequestOptions,
  ): Promise<{ tools: AdapterToolDef[] }>;
  listResources(
    params?: unknown,
    options?: AdapterRequestOptions,
  ): Promise<{ resources: AdapterResourceDef[] }>;
  listResourceTemplates(
    params?: unknown,
    options?: AdapterRequestOptions,
  ): Promise<{ resourceTemplates: AdapterResourceTemplateDef[] }>;
  listPrompts(
    params?: unknown,
    options?: AdapterRequestOptions,
  ): Promise<{ prompts: AdapterPromptDef[] }>;
  getPrompt(params: unknown, options?: AdapterRequestOptions): Promise<unknown>;
  readResource(params: unknown, options?: AdapterRequestOptions): Promise<unknown>;
  callTool(params: unknown, options?: AdapterRequestOptions): Promise<unknown>;
  close(): Promise<void>;
}

export interface AdapterConnectionLike {
  client: AdapterClientLike;
  status: 'connected' | 'closed' | 'needs-auth';
  tools: AdapterToolDef[];
  resources: AdapterResourceDef[];
  prompts: AdapterPromptDef[];
  definition: AdapterServerEntry;
}

/** Structural subset of the adapter McpServerManager the facade drives. */
export interface AdapterManagerLike {
  connect(
    name: string,
    definition: AdapterServerEntry,
    signal?: AbortSignal,
  ): Promise<AdapterConnectionLike>;
  reconnect(
    name: string,
    definition: AdapterServerEntry,
    stale: AdapterConnectionLike,
    signal?: AbortSignal,
  ): Promise<AdapterConnectionLike>;
  getPrompt(
    name: string,
    promptName: string,
    args?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  readResource(name: string, uri: string, signal?: AbortSignal): Promise<unknown>;
  getConnection(name: string): AdapterConnectionLike | undefined;
  getAllConnections?(): Map<string, AdapterConnectionLike>;
  getRequestOptions?(name: string, signal?: AbortSignal): AdapterRequestOptions | undefined;
  close(name: string): Promise<void>;
  closeAll(): Promise<void>;
}

export interface AdapterManagerClass {
  new (defaultCwd?: string): AdapterManagerLike;
}

export interface AdapterStartAuthResult {
  authorizationUrl?: string | null;
}

export interface AdapterAuthFlow {
  startAuth(
    serverName: string,
    serverUrl: string,
    definition: AdapterServerEntry,
    options?: { signal?: AbortSignal; runtime?: unknown; authStorageOptions?: unknown },
  ): Promise<AdapterStartAuthResult>;
  completeAuthFromInput(
    serverName: string,
    input: string,
    options?: { signal?: AbortSignal; runtime?: unknown; authStorageOptions?: unknown },
  ): Promise<string>;
  getAuthStatus(serverName: string, options?: unknown): Promise<unknown>;
  removeAuth(serverName: string, options?: unknown): Promise<void>;
  supportsOAuth(definition: AdapterServerEntry): boolean;
  createOAuthRuntime?(signal?: AbortSignal): unknown;
}

export interface AdapterApprovalRequest {
  requestId: string;
  serverName: string;
  originalToolName: string;
  prefixedToolName: string;
  args: Record<string, unknown>;
  origin: string;
  signal?: AbortSignal;
  claim(handler: () => unknown): boolean;
}

export interface AdapterValidator {
  getValidator(
    schema: Record<string, unknown>,
  ): (value: unknown) => { valid: boolean; errorMessage?: string };
}

export interface AdapterInternals {
  source: AdapterModuleSource;
  dir: string;
  version: string;
  createMcpAdapter: AdapterFactory;
  McpServerManager: AdapterManagerClass;
  authFlow: AdapterAuthFlow;
  approvalEvent: string;
  isServerDisabled: (definition: AdapterServerEntry | undefined) => boolean;
  registerMcpServer?: (options: { pi: unknown; name: string; definition: AdapterServerEntry }) => {
    dispose(): Promise<void>;
  };
  createJsonSchemaValidator: () => AdapterValidator;
  normalizeDirectToolInputSchema?: (schema: unknown) => Record<string, unknown>;
}
