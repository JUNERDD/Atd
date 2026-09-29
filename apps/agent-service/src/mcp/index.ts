/**
 * MCP authority public surface for service wiring and T5. Canonical MCP
 * schemas come from `@ai/agent-contracts`; requests stay service-side.
 */
export { McpAuthority, type McpAuthorityDeps } from './authority.js';
export { McpFacade, type FacadeDeps } from './facade.js';
export {
  MappingError,
  McpError,
  isForbidden,
  isUnauthorized,
  requireManager,
  type ManagerAccessor,
  type MappingContext,
  type MappingDeps,
  type McpErrorCode,
  type McpPreapproval,
  type McpStateSink,
  type McpUpdate,
  type OperationContext,
  type SecretResolver,
  type ServerResolver,
} from './errors.js';
export { ConnectionManager, type ConnectionDeps, type EnsuredConnection } from './connect.js';
export { McpPolicy, type PolicyDeps } from './policy.js';
export { serverView, upsertRecord } from './server-edits.js';
export { migrateMcpSecrets } from './secrets-migration.js';
export { McpAuthManager, McpConnectionStates, buildSnapshot, type AuthDeps } from './lifecycle.js';
export {
  CredentialTransactions,
  LateWritebackProhibited,
  TxnAborted,
  TxnRevoked,
  type TokenOp,
  type TokenOpKind,
} from './transactions.js';
export {
  McpHostCallbacks,
  redactUrl,
  withUiViewerNone,
  type HostCallbackScope,
} from './callbacks.js';
export { McpApprovalBroker, type ApprovalBus, type McpApprovalContext } from './approval.js';
export {
  ControlSession,
  type ControlSessionDeps,
  type ControlSettingsProof,
  type ModelCallCounts,
} from './control-session.js';
export {
  McpAdapterMissing,
  forgetAdapterForTests,
  loadAdapterInternals,
  resolveAdapterDir,
  scopeAdapterEnv,
  setAdapterInternalsForTests,
} from './loader.js';
export type {
  AdapterApprovalRequest,
  AdapterAuthFlow,
  AdapterClientLike,
  AdapterConnectionLike,
  AdapterFactory,
  AdapterInternals,
  AdapterManagerClass,
  AdapterManagerLike,
  AdapterMcpConfig,
  AdapterModuleSource,
  AdapterServerEntry,
} from './adapter-types.js';
export {
  mapCallResult,
  mapGetPrompt,
  mapReadResource,
  promptPreviewToInput,
  toPiText,
} from './mapping.js';
export { MAX_BLOB_BYTES, adoptTempPaths, materializeBlob } from './artifacts.js';
export {
  mcpCapabilityId,
  parseMcpCapabilityId,
  type McpCallResult,
  type McpServerConfig,
  type McpServerStatus,
  type McpSnapshot,
} from '@ai/agent-contracts';
export {
  McpAuthCompleteRequestSchema,
  McpCallToolRequestSchema,
  McpGetPromptRequestSchema,
  McpReadResourceRequestSchema,
  McpServerRequestSchema,
  McpStageRequestSchema,
} from './requests.js';
export {
  handleMcpAuthComplete,
  handleMcpAuthStart,
  handleMcpCallTool,
  handleMcpConnect,
  handleMcpDisconnect,
  handleMcpGetPrompt,
  handleMcpListPrompts,
  handleMcpListResourceTemplates,
  handleMcpListResources,
  handleMcpListTools,
  handleMcpLogout,
  handleMcpReadResource,
  handleMcpRecords,
  handleMcpRemove,
  handleMcpReconnect,
  handleMcpRefresh,
  handleMcpRevoke,
  handleMcpSetEnabled,
  handleMcpSnapshot,
  handleMcpStage,
  handleMcpStatus,
  handleMcpUpsert,
  mcpErrorStatus,
  registerMcpRoutes,
  type McpAuthorityResolver,
  type McpRouteDeps,
} from './routes.js';
export {
  classifyRedirect,
  credentialIdentity,
  isTaskAlias,
  matchToolPattern,
  matchUriTemplate,
  parseServerConfigs,
  physicalName,
  probeStdioRuntime,
  reuseKey,
  serversFile,
  toAdapterConfig,
  toAdapterServerEntry,
  type StdioProbe,
} from './servers.js';
export {
  mcpProxyName,
  mcpProxyPrefix,
  prepareMcpTools,
  type McpProxyDetails,
  type McpGuardedCall,
  type McpProxyHost,
  type McpProxyOptions,
  type McpToolBinding,
} from './tool-proxies.js';
