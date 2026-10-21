import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import {
  ComputerHashSchema,
  COMPUTER_MAX_BINDINGS,
  Identifier,
  parse,
  type RunComputer,
  type TargetBinding,
  type TargetBindingContent,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import type { ComputerBindingStore } from './bindings.js';

const GrantSchema = Type.Object(
  {
    bindingId: Identifier,
    hash: ComputerHashSchema,
  },
  { additionalProperties: false },
);
const FileSchema = Type.Object(
  {
    version: Type.Literal(1),
    grants: Type.Array(GrantSchema, { maxItems: COMPUTER_MAX_BINDINGS }),
  },
  { additionalProperties: false },
);
type AccessGrant = Static<typeof GrantSchema>;

/**
 * `access.json` as it reads today. A grant written before computer protocol 8 also records whether
 * it allowed foreground control (`foreground`); access never selects a delivery now (the host's
 * foreground fallback depends on the run, not on access), so the flag is dropped before the parse
 * (docs/plans/2026-10-19-imperceptible-computer-use.md §10.2). The file keeps it until the next
 * change rewrites the grants.
 */
function withoutForeground(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('grants' in raw) || !Array.isArray(raw.grants))
    return raw;
  return {
    ...raw,
    grants: raw.grants.map((grant: unknown) => {
      if (typeof grant !== 'object' || grant === null || !('foreground' in grant)) return grant;
      const { foreground: _retired, ...rest } = grant;
      void _retired;
      return rest;
    }),
  };
}

/** Attended access, separate from automation grants and the immutable submission snapshot. */
export class ComputerAccess {
  private readonly runs = new Map<string, Map<string, AccessGrant>>();
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly file: string,
    private readonly bindings: ComputerBindingStore,
    private grants: AccessGrant[],
  ) {
    bindings.onChange((id) => this.revoke(id));
  }

  static async load(dataDir: string, bindings: ComputerBindingStore): Promise<ComputerAccess> {
    const file = path.join(dataDir, 'computer', 'access.json');
    let grants: AccessGrant[] = [];
    try {
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
      grants = parse(FileSchema, withoutForeground(raw)).grants;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return new ComputerAccess(file, bindings, grants);
  }

  /** A saved binding is reusable only while the host resolves the same identity and scope. */
  matching(content: TargetBindingContent, runId: string): TargetBinding | undefined {
    const available = [...this.bindings.list(), ...this.bindings.temporaryFor(runId)];
    return available.find((binding) => {
      if (content.kind === 'native' && binding.kind === 'native')
        return (
          binding.bundleId === content.bundleId &&
          binding.appPath === content.appPath &&
          binding.teamId === content.teamId
        );
      return (
        content.kind === 'browser' &&
        binding.kind === 'browser' &&
        binding.allowedOrigins.length === content.allowedOrigins.length &&
        binding.allowedOrigins.every((origin) => content.allowedOrigins.includes(origin))
      );
    });
  }

  /** Whether saved access covers this binding at its current content. */
  allows(binding: TargetBinding): boolean {
    return this.grants.some(
      (grant) => grant.bindingId === binding.bindingId && grant.hash === binding.hash,
    );
  }

  /** Whether the run was granted access to this binding at its current content. */
  inRun(runId: string, binding: TargetBinding): boolean {
    return this.runs.get(runId)?.get(binding.bindingId)?.hash === binding.hash;
  }

  async allow(runId: string, binding: TargetBinding, persistent: boolean): Promise<void> {
    const grant = { bindingId: binding.bindingId, hash: binding.hash };
    if (persistent)
      await this.change(() => [
        ...this.grants.filter((item) => item.bindingId !== binding.bindingId),
        grant,
      ]);
    const run = this.runs.get(runId) ?? new Map<string, AccessGrant>();
    run.set(binding.bindingId, grant);
    this.runs.set(runId, run);
  }

  effective(runId: string, frozen: RunComputer | undefined): RunComputer | undefined {
    if (frozen?.grant || frozen?.trial) return frozen;
    const grants = [...(this.runs.get(runId)?.values() ?? [])].filter((grant) =>
      this.bindings.matches(grant.bindingId, grant.hash),
    );
    if (!grants.length) return frozen;
    return {
      ...frozen,
      bindingIds: [...new Set([...(frozen?.bindingIds ?? []), ...grants.map((g) => g.bindingId)])],
    };
  }

  forget(runId: string): void {
    this.runs.delete(runId);
    this.bindings.forgetTemporary(runId);
  }

  private async revoke(bindingId: string): Promise<void> {
    for (const run of this.runs.values()) run.delete(bindingId);
    // Queue behind pending approvals even when their grant is not visible in memory yet.
    await this.change(() => this.grants.filter((grant) => grant.bindingId !== bindingId));
  }

  private change(update: () => AccessGrant[]): Promise<void> {
    const next = this.chain.then(async () => {
      const grants = update();
      await atomicWrite(this.file, { version: 1, grants });
      this.grants = grants;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
}
