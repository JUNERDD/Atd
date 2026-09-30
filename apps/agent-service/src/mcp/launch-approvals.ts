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
import { commandValueField, commandValueRefusal } from './servers.js';
import type { McpLaunchSpec } from './types.js';

/**
 * Launch approvals (G1), the single owner of whether an MCP server may launch. Every stdio server
 * (user or plugin, including `configure_mcp` servers and plugin duplicates) and every HTTP server
 * that can send a service env value (`launchKind`) is refused until the user approves it as it
 * stands: the connect path asks `assertLaunch` with the spec it is about to resolve and run.
 * Approving takes a shell-only route or the CLI (after a native or terminal confirmation);
 * withdrawing and the one-time notice are the renderer's.
 */

export interface LaunchGate {
  /** Throws McpError `approval_required` unless `spec` is what the user approved. */
  assertLaunch(record: McpServerConfig, spec: McpLaunchSpec): Promise<void>;
}

/** The connect path's own launch spec (`ConnectionManager.launchSpec`), never a second resolver. */
export type LaunchSpecOf = (record: McpServerConfig) => Promise<McpLaunchSpec>;

export interface LaunchApprovalDeps {
  dataDir: string;
  serviceId: string;
  /** Where a stdio server without its own cwd starts (the authority's cwd). */
  cwd: string;
  log: Logger;
}

export class LaunchApprovals implements LaunchGate {
  private constructor(
    private readonly deps: LaunchApprovalDeps,
    private readonly records: McpServerRecords,
    private readonly specOf: LaunchSpecOf,
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
    specOf: LaunchSpecOf,
  ): Promise<LaunchApprovals> {
    const store = await LaunchStore.load(
      deps.dataDir,
      deps.log,
      async () =>
        records.legacyPluginApprovals() ||
        records.all().some((record) => launchKind(record) !== null),
    );
    return new LaunchApprovals(deps, records, specOf, store);
  }

  async assertLaunch(record: McpServerConfig, spec: McpLaunchSpec): Promise<void> {
    refuseCommandValues(record, spec);
    const verdict = await this.verdict(record, spec);
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
      return await this.verdict(record, await this.specOf(record));
    } catch {
      return 'changed';
    }
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
    let spec: McpLaunchSpec;
    try {
      spec = await this.specOf(record);
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError('bad_request', serverId, errorMessage(error));
    }
    refuseCommandValues(record, spec);
    const fingerprint = launchFingerprint(await this.key(serverId), this.bound(record, spec));
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
        resolvedCommand: spec.command ?? record.stdio.command,
        args: spec.args ?? [],
        cwd: launchCwd(spec, this.deps.cwd),
        inheritEnv: spec.inheritEnv !== false,
        env: Object.entries(spec.env ?? {}).map(([key, value]) => ({
          key,
          sensitive: true as const,
          length: value.length,
          risky: isRiskyEnvKey(key),
        })),
      },
      http: kind === 'mcp-http-env' ? httpDetails(record, spec) : null,
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
    spec: McpLaunchSpec,
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
    return launchFingerprint(key, this.bound(record, spec)) === stored.fingerprint
      ? 'approved'
      : 'changed';
  }

  private bound(record: McpServerConfig, spec: McpLaunchSpec) {
    const source = this.records.pluginSource(record.serverId);
    const plugin: LaunchPlugin | null = source && { id: source.id, revision: source.revision };
    return { record, entry: spec, plugin, defaultCwd: this.deps.cwd };
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
 * Refuses a launch with an env or header value that starts with a single `!`. pi-mcp-adapter ran
 * such a value as a shell command in the service process; nothing runs it now, but no approval can
 * allow it either: the confirmation never shows env or header values, so the user could not see
 * what the value asked for, and a plain HTTP server needs no approval at all.
 */
function refuseCommandValues(record: McpServerConfig, spec: McpLaunchSpec): void {
  const field = commandValueField(spec);
  if (field) throw commandValueRefusal(record.serverId, field);
}

/** An HTTP launch as the confirmation shows it: where env values go, never a value. */
function httpDetails(
  record: McpServerConfig,
  spec: McpLaunchSpec,
): McpLaunchApprovalDetails['http'] {
  const url = spec.url ?? record.http?.url ?? '';
  const reads = httpEnvReads(url, spec.headers ?? {});
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
