import { errorMessage, type McpServerConfig } from '@atd/agent-contracts';
import { McpTimeoutError } from '@earendil-works/pi-mcp';
import type { Logger } from '../logging.js';
import {
  isForbidden,
  isSessionExpired,
  isUnauthorized,
  McpError,
  type McpStateSink,
  type OperationContext,
} from './errors.js';
import type { EnsuredConnection, McpConnections } from './types.js';

/**
 * How the facade runs the requests of one operation: on which connection, and what a failed
 * request means to the caller. The operations themselves and their gates live in facade.ts.
 */

/** What one operation runs on; `op` pins the configuration revision the operation started with. */
export interface OperationTarget {
  serverId: string;
  signal: AbortSignal | undefined;
  taskId: string | undefined;
  op?: OperationContext;
}

/**
 * The connection one operation uses, opened (and its revision pinned) once. A server that
 * forgot its session (a restart or deploy) did not run the request, so `run` drops that
 * connection, opens a new one and sends the request once more; nothing else is retried, and the
 * operation's later requests use the new connection.
 */
export class OperationSession {
  private constructor(
    private ensured: EnsuredConnection,
    private readonly connections: McpConnections,
    private readonly reopen: () => Promise<EnsuredConnection>,
    private readonly log: Logger,
  ) {}

  static async open(
    connections: McpConnections,
    log: Logger,
    { serverId, signal, taskId }: OperationTarget,
    pin: (record: McpServerConfig) => void,
  ): Promise<OperationSession> {
    const reopen = async () => {
      const ensured = await connections.ensure(serverId, signal, taskId);
      pin(ensured.record);
      return ensured;
    };
    return new OperationSession(await reopen(), connections, reopen, log);
  }

  async run<T>(phase: (ensured: EnsuredConnection) => Promise<T>): Promise<T> {
    // Closed while the operation waited (on an approval, say): nothing was sent, so a new
    // connection is safe.
    if (!this.ensured.connection.isOpen()) this.ensured = await this.reopen();
    try {
      return await phase(this.ensured);
    } catch (error) {
      if (!isSessionExpired(error)) throw error;
      this.log.info('MCP server forgot its session; sending the request once more.', {
        serverId: this.ensured.record.serverId,
      });
      await this.connections.discard(this.ensured.connection);
      this.ensured = await this.reopen();
      return phase(this.ensured);
    }
  }
}

/**
 * What a failed request means to the caller. pi-mcp's JSON-RPC errors and closed-connection
 * errors keep their own message through the last line.
 */
export function translateCallError(
  states: McpStateSink,
  serverId: string,
  error: unknown,
): McpError {
  if (error instanceof McpError) return error;
  if (isUnauthorized(error)) {
    states.set(serverId, 'auth_required', '');
    return new McpError('auth_required', serverId, `MCP server ${serverId} needs authentication.`);
  }
  if (isForbidden(error)) {
    // 403 scope step-up is an explicit reauth, never a silent replay.
    states.set(serverId, 'auth_required', '');
    return new McpError(
      'auth_required',
      serverId,
      `MCP server ${serverId} refused the credential (reauthentication required).`,
    );
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new McpError('internal', serverId, 'The MCP call was cancelled.');
  }
  if (error instanceof McpTimeoutError) {
    return new McpError(
      'internal',
      serverId,
      `MCP server ${serverId} did not answer within ${error.timeoutMs} ms.`,
    );
  }
  return new McpError('internal', serverId, errorMessage(error));
}
