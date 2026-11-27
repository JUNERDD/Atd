import type { BrowserChannel } from './connection.js';
import { errorMessage, workerLog } from './log.js';
import { OperationRegistry, WorkerError, type Operation } from './operations.js';
import { truncate } from './text.js';

export type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

/** The text content mirrors the structured result without screenshot data. */
export function toolResult(structured: Record<string, unknown>, isError: boolean): ToolResult {
  const { screenshot, frame, ...rest } = structured;
  if (frame !== undefined) rest.frame = '[preview jpeg]';
  const text = JSON.stringify(screenshot === undefined ? rest : { ...rest, screenshot: '[png]' });
  return isError
    ? { content: [{ type: 'text', text }], structuredContent: structured, isError: true }
    : { content: [{ type: 'text', text }], structuredContent: structured };
}

export interface OperationLogContext {
  tool: string;
  channel?: BrowserChannel;
}

/**
 * Runs one page tool as an operation and shapes its result: `dispatched` comes from the
 * operation, so a failure after a dispatch still says the page may have changed. Errors that are
 * not a `WorkerError` (CDP failures, a closed socket) become `engineFailed`.
 */
export async function runOperation(
  registry: OperationRegistry,
  signal: AbortSignal,
  input: { pageId?: string; operationId?: string | undefined },
  work: (op: Operation) => Promise<Record<string, unknown>>,
  report: () => Promise<Record<string, unknown>> = async () => ({}),
  context?: OperationLogContext,
): Promise<ToolResult> {
  const op = registry.begin(signal, input.operationId);
  const page = () => ({
    dispatched: op.dispatched,
    pageId: input.pageId,
    navigationGeneration: op.navigationGeneration,
    observationVersion: op.observationVersion,
  });
  try {
    const fields = await work(op);
    return toolResult({ ok: true, ...page(), ...fields, ...(await report()) }, false);
  } catch (error) {
    const code = error instanceof WorkerError ? error.code : 'engineFailed';
    const message = truncate(errorMessage(error), 2000);
    workerLog({
      level: code === 'engineFailed' ? 'error' : 'warn',
      cat: 'operation',
      code,
      msg: message,
      tool: context?.tool,
      channel: context?.channel,
      pageId: input.pageId,
      operationId: input.operationId,
    });
    const saved = await report();
    return toolResult({ ok: false, ...page(), error: { code, message }, ...saved }, true);
  } finally {
    registry.end(op);
  }
}
