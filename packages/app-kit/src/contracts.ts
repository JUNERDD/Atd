/**
 * The shapes app-kit shares with the service and the shell, taken from their owners:
 * `@atd/agent-contracts` (backend IPC, capability operations, NDJSON lines, events, widgets) and
 * `apps/desktop/src/native-bridge/user-app-contract.ts` (the `atdApp` bridge, which a package
 * cannot import, so its call shapes are mirrored below). Imports here are type-only: the browser
 * and backend SDKs are bundled into every app, and must not pull in TypeBox schemas. The service
 * validates every message and widget timeline against the schemas themselves.
 */
export type {
  AgentRunChunk,
  AgentRunInput,
  AgentRunOutput,
  AiGenerateInput,
  AiGenerateOutput,
  AiMessage,
  AiStreamChunk,
  AppCapRequest,
  AppCapabilityOpInput,
  AppCapabilityOpName,
  AppCapabilityOpOutput,
  AppChildMessage,
  AppError,
  AppEvent,
  AppMcpTool,
  AppParentMessage,
  AppStreamLine,
  Capability,
  McpCallToolInput,
  McpCallToolOutput,
  McpListToolsInput,
  MemoryEntry,
  MemoryReadInput,
  MemorySearchInput,
  MemoryWriteInput,
  WebFetchInput,
  WebFetchOutput,
  WebSearchInput,
  WebSearchResult,
  WidgetBackground,
  WidgetChartPoint,
  WidgetColor,
  WidgetConfig,
  WidgetDecl,
  WidgetEntry,
  WidgetFamily,
  WidgetFontWeight,
  WidgetListRow,
  WidgetNode,
  WidgetRoute,
  WidgetTextStyle,
  WidgetTimeline,
} from '@atd/agent-contracts';

/** Mirrors `USER_APP_MESSAGE_HANDLER` of the user-app bridge contract. */
export const USER_APP_HANDLER = 'atdApp';

/**
 * Mirrors `UserAppCalls` of the user-app bridge contract: what the page posts as
 * `{type: 'call', method, params}` and what the shell's reply resolves to.
 */
export interface UserAppCalls {
  'clipboard.write': { params: { text: string }; result: Record<string, never> };
  'link.open': { params: { url: string }; result: Record<string, never> };
  'files.pick': {
    params: { types?: string[]; multiple?: boolean };
    result: { files: { name: string; bytesBase64: string }[] };
  };
  'files.save': {
    params: { suggestedName: string; bytesBase64: string };
    result: { saved: boolean };
  };
}
