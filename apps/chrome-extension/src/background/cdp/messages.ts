import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

/**
 * CDP messages between the worker (Playwright's `connectOverCDP`) and the emulated browser
 * endpoint. Commands arrive as JSON text in `cdp` frames and are validated here; responses and
 * events go back as JSON text.
 */

const CommandSchema = Type.Object({
  id: Type.Integer({ minimum: 0 }),
  method: Type.String({ minLength: 1, maxLength: 256 }),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
});
export type CdpCommand = Static<typeof CommandSchema>;
export type CdpParams = Record<string, unknown>;

/** What the endpoint sends: a response (result or error) or an event, on a session or the root. */
export type CdpOutbound =
  | { id: number; sessionId?: string; result: object }
  | { id: number; sessionId?: string; error: { code: number; message: string } }
  | { method: string; params: CdpParams; sessionId?: string };

/** JSON-RPC / CDP error codes the endpoint answers with. */
export const CDP_ERROR = {
  server: -32000,
  sessionNotFound: -32001,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
} as const;

/** A protocol error to send back as the command's `error`. */
export class CdpError extends Error {
  constructor(
    message: string,
    readonly code: number = CDP_ERROR.server,
  ) {
    super(message);
  }
}

/** A method the policy does not let through (`policy.ts`). */
export function refused(method: string): CdpError {
  return new CdpError(`${method} is not available in Atd for Chrome.`, CDP_ERROR.methodNotFound);
}

export type ParsedCommand =
  | { ok: true; command: CdpCommand }
  | { ok: false; id?: number; sessionId?: string };

/** One command from the worker, or what is known of an invalid one (to answer it with an error). */
export function parseCommand(text: string): ParsedCommand {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (Value.Check(CommandSchema, value)) return { ok: true, command: value };
  if (typeof value !== 'object' || value === null) return { ok: false };
  const id: unknown = Reflect.get(value, 'id');
  const sessionId: unknown = Reflect.get(value, 'sessionId');
  return {
    ok: false,
    ...(typeof id === 'number' && Number.isInteger(id) ? { id } : {}),
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
  };
}

const ProtocolErrorSchema = Type.Object({ code: Type.Integer(), message: Type.String() });

/**
 * A `chrome.debugger.sendCommand` rejection as a CDP error. Chrome rejects with the protocol's
 * own error serialized as the message (`{"code":-32000,"message":"…"}`), or with a plain message
 * for its own failures ("Debugger is not attached to the tab …").
 */
export function debuggerError(error: unknown): CdpError {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed: unknown = JSON.parse(message);
    if (Value.Check(ProtocolErrorSchema, parsed)) return new CdpError(parsed.message, parsed.code);
  } catch {
    // Not JSON: Chrome's own message.
  }
  return new CdpError(message);
}

export function stringParam(params: CdpParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
}
