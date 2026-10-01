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
export { ConnectionManager, type ConnectionDeps } from './connect.js';
export { createTransport } from './transports.js';
export { resolveHttpUrl, resolveLaunch } from './launch-resolve.js';
export { McpPolicy, type PolicyDeps } from './policy.js';
export { serverView, upsertRecord } from './server-edits.js';
export { migrateMcpSecrets } from './secrets-migration.js';
export { McpConnectionStates, buildSnapshot } from './lifecycle.js';
export { McpAuthManager, type AuthDeps } from './oauth-flow.js';
export { OAuthProviders } from './oauth-provider.js';
export { KeychainOAuthStore } from './oauth-store.js';
export { migrateAdapterOAuth } from './oauth-migration.js';
export {
  CredentialTransactions,
  LateWritebackProhibited,
  TxnAborted,
  TxnRevoked,
  type TokenOp,
  type TokenOpKind,
} from './transactions.js';
export { McpNotices, redactUrl } from './callbacks.js';
export { McpApprovalBroker, type McpApprovalContext } from './approval.js';
export type * from './types.js';
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
  toLaunchSpec,
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
