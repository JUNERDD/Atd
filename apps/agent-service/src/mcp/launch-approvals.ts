import {
  errorMessage,
  type McpLaunchApprovalDetails,
  type McpLaunchApprovalRecord,
  type McpLaunchApprovalState,
  type McpLaunchApproveRequest,
  type McpServerConfig,
  type McpSnapshot,
  type McpStatusResponse,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import type { AdapterServerEntry } from './adapter-types.js';
import { McpError } from './errors.js';
import { httpEnvReads } from './env-references.js';
import {
  isRiskyEnvKey,
  launchCwd,
  launchFingerprint,
  launchKind,
  tokenEnvOf,
  type LaunchPlugin,
} from './launch-fingerprint.js';
import { launchKey, readLaunchKey } from './launch-key.js';
import { LaunchStore } from './launch-store.js';
import type { McpServerRecords } from './server-records.js';
import { adapterCommandValue, toAdapterServerEntry } from './servers.js';

/**
 * Launch approvals (G1), the single owner of whether an MCP server may launch. Every stdio server
 * (user or plugin, including `configure_mcp` servers and plugin duplicates) and every HTTP server
 * that can send a service env value (`launchKind`) is refused until the user approves it as it
 * stands: the connect path asks `assertLaunch` with the entry it is about to hand the adapter, and
 * the control session's own adapter config leaves unapproved servers out. Approving takes a
 * shell-only route or the CLI (after a native or terminal confirmation); withdrawing and the
 * one-time notice are the renderer's.
 */

export interface LaunchGate {
  /** Throws McpError `approval_required` unless `entry` is what the user approved. */
  assertLaunch(record: McpServerConfig, entry: AdapterServerEntry): Promise<void>;
}

/** The connect path's own launch entry (`ConnectionManager.launchEntry`), never a second resolver. */
export type LaunchEntryOf = (record: McpServerConfig) => Promise<AdapterServerEntry>;

export interface LaunchApprovalDeps {
  dataDir: string;
  serviceId: string;
  /** Where a stdio server without its own cwd starts (the control session's cwd). */
  cwd: string;
  log: Logger;
}

export class LaunchApprovals implements LaunchGate {
  private constructor(
    private readonly deps: LaunchApprovalDeps,
    private readonly records: McpServerRecords,
    private readonly entryOf: LaunchEntryOf,
    private readonly store: LaunchStore,
  ) {}

  /**
   * Loads the store. The first load of a profile from before launch approvals writes it with the
   * one-time notice due when any server needs approval now or plugin state held old approvals;
   * no approval carries over.
   */
  static async load(
    deps: LaunchApprovalDeps,
    records: McpServerRecords,
    entryOf: LaunchEntryOf,
  ): Promise<LaunchApprovals> {
    const store = await LaunchStore.load(
      deps.dataDir,
      deps.log,
      async () =>
        records.legacyPluginApprovals() ||
        records.all().some((record) => launchKind(record) !== null),
    );
    return new LaunchApprovals(deps, records, entryOf, store);
  }

  async assertLaunch(record: McpServerConfig, entry: AdapterServerEntry): Promise<void> {
    refuseCommandValues(record, entry);
    const verdict = await this.verdict(record, entry);
    if (verdict === 'approved' || verdict === 'notRequired') return;
    const why =
      verdict === 'changed'
        ? `changed since the user approved it, so it needs the user's approval again`
        : `needs the user's approval before it can run`;
    throw new McpError(
      'approval_required',
      record.serverId,
      `MCP server ${record.serverId} ${why}. Ask the user to approve it in Settings › Extensions; it cannot be approved from a task.`,
    );
  }

  /** A server's approval as status rows show it; resolving its launch only when one is stored. */
  async state(record: McpServerConfig): Promise<McpLaunchApprovalState> {
    if (!launchKind(record)) return 'notRequired';
    if (!this.store.get(record.serverId)) return 'required';
    try {
      return await this.verdict(record, await this.entryOf(record));
    } catch {
      return 'changed';
    }
  }

  /** The records that may launch now: the control session's adapter config holds only these. */
  async launchable(records: McpServerConfig[]): Promise<McpServerConfig[]> {
    const states = await Promise.all(records.map((record) => this.state(record)));
    return records.filter(
      (record, index) =>
        (states[index] === 'approved' || states[index] === 'notRequired') &&
        !adapterCommandValue(toAdapterServerEntry(record)),
    );
  }

  /** `/v1/mcp/status`: the snapshot's rows with their plugin and approval, and the notice. */
  async status(snapshot: McpSnapshot): Promise<McpStatusResponse> {
    const states = await Promise.all(
      this.records
        .all()
        .map(async (record) => [record.serverId, await this.state(record)] as const),
    );
    return {
      servers: this.records.statusRows(snapshot.servers, new Map(states)),
      approvalNotice: this.store.notice(),
    };
  }

  /** What approving would allow, for the native confirmation. Env and header values never leave. */
  async details(serverId: string): Promise<McpLaunchApprovalDetails> {
    const record = this.records.record(serverId);
    const kind = launchKind(record);
    if (!kind)
      throw new McpError(
        'bad_request',
        serverId,
        `MCP server ${serverId} needs no launch approval.`,
      );
    let entry: AdapterServerEntry;
    try {
      entry = await this.entryOf(record);
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError('bad_request', serverId, errorMessage(error));
    }
    refuseCommandValues(record, entry);
    const fingerprint = launchFingerprint(await this.key(serverId), this.bound(record, entry));
    const stored = this.store.get(serverId);
    const source = this.records.pluginSource(serverId);
    return {
      serverId,
      name: source?.localName ?? serverId,
      layer: source ? 'plugin' : 'user',
      kind,
      state: !stored ? 'required' : stored.fingerprint === fingerprint ? 'approved' : 'changed',
      plugin: source && {
        id: source.id,
        name: source.name,
        version: source.version,
        source: source.source,
        revision: source.revision,
      },
      stdio: record.stdio && {
        command: record.stdio.command,
        resolvedCommand: entry.command ?? record.stdio.command,
        args: entry.args ?? [],
        cwd: launchCwd(entry, this.deps.cwd),
        inheritEnv: entry.inheritEnv !== false,
        env: Object.entries(entry.env ?? {}).map(([key, value]) => ({
          key,
          sensitive: true as const,
          length: value.length,
          risky: isRiskyEnvKey(key),
        })),
      },
      http: kind === 'mcp-http-env' ? httpDetails(record, entry) : null,
      fingerprint,
    };
  }

  /**
   * Records an approval the shell or CLI confirmed. The fingerprint is recomputed now: a server
   * that changed after its details were shown is refused (`approval_changed`) and nothing stored.
   */
  async approve(request: McpLaunchApproveRequest): Promise<McpLaunchApprovalRecord> {
    const { serverId } = request;
    const details = await this.details(serverId);
    if (details.fingerprint !== request.fingerprint)
      throw new McpError(
        'approval_changed',
        serverId,
        `MCP server ${serverId} changed after its details were read; read them again and confirm.`,
      );
    const source = this.records.pluginSource(serverId);
    const record: McpLaunchApprovalRecord = {
      v: 1,
      kind: details.kind,
      serverId,
      layer: details.layer,
      ...(source
        ? { plugin: { id: source.id, revision: source.revision, resolved: source.source } }
        : {}),
      fingerprint: details.fingerprint,
      approvedAt: new Date().toISOString(),
      via: request.via,
    };
    await this.store.put(record);
    this.deps.log.info('MCP launch approved.', { serverId, via: request.via });
    return record;
  }

  /** Withdraws a configured server's approval; the caller stops what runs. */
  async withdraw(serverId: string): Promise<void> {
    this.records.record(serverId);
    await this.store.remove(serverId);
  }

  /** Drops the approval of a server that no longer exists. */
  async forget(serverId: string): Promise<void> {
    await this.store.remove(serverId);
  }

  dismissNotice(): Promise<void> {
    return this.store.dismissNotice();
  }

  private async verdict(
    record: McpServerConfig,
    entry: AdapterServerEntry,
  ): Promise<McpLaunchApprovalState> {
    if (!launchKind(record)) return 'notRequired';
    const stored = this.store.get(record.serverId);
    if (!stored) return 'required';
    const key = await readLaunchKey(this.deps.serviceId).catch((error: unknown) => {
      this.deps.log.warn('The launch approval key could not be read; launches stay refused.', {
        error: errorMessage(error),
      });
      return null;
    });
    if (!key) return 'changed';
    return launchFingerprint(key, this.bound(record, entry)) === stored.fingerprint
      ? 'approved'
      : 'changed';
  }

  private bound(record: McpServerConfig, entry: AdapterServerEntry) {
    const source = this.records.pluginSource(record.serverId);
    const plugin: LaunchPlugin | null = source && { id: source.id, revision: source.revision };
    return { record, entry, plugin, defaultCwd: this.deps.cwd };
  }

  private async key(serverId: string): Promise<Buffer> {
    try {
      return await launchKey(this.deps.serviceId);
    } catch (error) {
      throw new McpError(
        'internal',
        serverId,
        `The OS keyring is unavailable, so launch approvals cannot be checked: ${errorMessage(error)}`,
      );
    }
  }
}

/**
 * Refuses a launch in which pi-mcp-adapter would run a value as a shell command in the service
 * process. No approval can allow it: the confirmation never shows env or header values, so the
 * user could not see the command, and a plain HTTP server needs no approval at all.
 */
function refuseCommandValues(record: McpServerConfig, entry: AdapterServerEntry): void {
  const field = adapterCommandValue(entry);
  if (field)
    throw new McpError(
      'forbidden',
      record.serverId,
      `MCP server ${record.serverId} sets ${field} to a value starting with "!", which would run as a command; write "!!" for a literal "!".`,
    );
}

/** An HTTP launch as the confirmation shows it: where env values go, never a value. */
function httpDetails(
  record: McpServerConfig,
  entry: AdapterServerEntry,
): McpLaunchApprovalDetails['http'] {
  const url = entry.url ?? record.http?.url ?? '';
  const reads = httpEnvReads(url, entry.headers ?? {});
  const headerKeys = [...reads.headers.keys()].sort();
  return {
    url,
    tokenEnv: tokenEnvOf(record),
    headerKeys,
    urlReadsEnv: reads.url.length > 0,
    headers: headerKeys.map((key) => ({ key, readsEnv: !!reads.headers.get(key)?.length })),
    envReferences: reads.names,
  };
}
