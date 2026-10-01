import type {
  McpConnectionState,
  McpServerConfig,
  McpServerStatus,
  McpSnapshot,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { announceMcpChanged } from './changes.js';
import type { McpStateSink } from './errors.js';

/**
 * Logical connection states (D6): disabled/disconnected/connecting/auth_required/ready/error/
 * closing. Connections, the sign-in flow (oauth-flow.ts) and the facade move a server between
 * them; the snapshot rows clients list are built from them, so every change is announced for the
 * profile in `dataDir` (changes.ts) and clients reload those rows.
 */

export class McpConnectionStates implements McpStateSink {
  private readonly states = new Map<string, { state: McpConnectionState; lastError: string }>();

  constructor(
    private readonly log: Logger,
    private readonly dataDir: string,
  ) {}

  set(serverId: string, state: McpConnectionState, lastError = ''): void {
    const before = this.states.get(serverId);
    this.states.set(serverId, { state, lastError });
    this.log.debug('MCP connection state changed.', { serverId, state });
    if (before?.state !== state || before.lastError !== lastError) announceMcpChanged(this.dataDir);
  }

  get(serverId: string): McpConnectionState {
    return this.states.get(serverId)?.state ?? 'disconnected';
  }

  lastError(serverId: string): string {
    return this.states.get(serverId)?.lastError ?? '';
  }

  reset(records: McpServerConfig[]): void {
    const known = new Set(records.map((record) => record.serverId));
    for (const id of [...this.states.keys()]) {
      if (!known.has(id)) this.states.delete(id);
    }
    for (const record of records) {
      if (!this.states.has(record.serverId)) {
        this.states.set(record.serverId, {
          state: record.disabled ? 'disabled' : 'disconnected',
          lastError: '',
        });
      } else if (record.disabled) {
        this.states.set(record.serverId, { state: 'disabled', lastError: '' });
      } else if (this.states.get(record.serverId)?.state === 'disabled') {
        // Re-enabled: it starts over as a server that has not connected yet.
        this.states.set(record.serverId, { state: 'disconnected', lastError: '' });
      }
    }
  }
}

/**
 * Snapshotter shape T34int/T5 consume; counts are live while a connection is open, else what the
 * server last offered under its present configuration (connect.ts `counts`, catalog-memory.ts).
 */
export function buildSnapshot(
  records: McpServerConfig[],
  states: McpConnectionStates,
  revision: number,
  counts: (serverId: string) => { tools: number; resources: number; prompts: number },
): McpSnapshot {
  const servers: McpServerStatus[] = records.map((record) => {
    const count = counts(record.serverId);
    return {
      serverId: record.serverId,
      connectionId: record.connectionId,
      configRevision: record.revision,
      state: states.get(record.serverId),
      toolCount: count.tools,
      resourceCount: count.resources,
      promptCount: count.prompts,
      disabled: record.disabled,
      lastError: states.lastError(record.serverId),
    };
  });
  return { revision, servers };
}
