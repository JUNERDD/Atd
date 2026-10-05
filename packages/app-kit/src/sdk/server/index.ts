/**
 * `@atd/app-kit/server`: what an app's `server/index.ts` imports. The builder bundles it into the
 * app's single-file backend; the context itself comes from the runtime at call time.
 */
export { defineBackend } from './backend.ts';
export { defineWidget, w, type WidgetDefinition, type WidgetRenderOptions } from './widgets.ts';
export type * from './types.ts';
export type {
  AgentRunChunk,
  AgentRunInput,
  AgentRunOutput,
  AiGenerateInput,
  AiGenerateOutput,
  AiMessage,
  AiStreamChunk,
  WidgetColor,
  WidgetEntry,
  WidgetFamily,
  WidgetNode,
  WidgetTextStyle,
  WidgetTimeline,
} from '../../contracts.ts';
