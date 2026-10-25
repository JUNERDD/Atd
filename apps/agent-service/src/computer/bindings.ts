import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  canonicalJson,
  COMPUTER_MAX_BINDINGS,
  errorMessage,
  parse,
  TargetBindingSchema,
  type SaveComputerBindingRequest,
  type TargetBinding,
  type TargetBindingContent,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import type { Logger } from '../logging.js';

/**
 * The store file: every registered binding, rewritten whole on each change. Only version 2 is
 * read or written; nothing is rehashed at load, so a stored hash keeps matching the grants that
 * froze it until its content really changes.
 */
const BINDINGS_VERSION = 2;
const BindingsFileSchema = Type.Object(
  {
    version: Type.Literal(BINDINGS_VERSION),
    bindings: Type.Array(TargetBindingSchema, { maxItems: COMPUTER_MAX_BINDINGS }),
  },
  { additionalProperties: false },
);

/** Why the stored file cannot be used, or null when it loaded (or was absent). */
function fileProblem(raw: unknown): string | null {
  if (Value.Check(BindingsFileSchema, raw)) return null;
  const version =
    typeof raw === 'object' && raw !== null && 'version' in raw ? raw.version : undefined;
  if (typeof version !== 'number' || version === BINDINGS_VERSION)
    return 'The computer targets file is damaged.';
  return version > BINDINGS_VERSION
    ? `The computer targets file is from a newer version of Atd (version ${version}).`
    : `The computer targets file has version ${version}, which this version of Atd cannot read.`;
}

/**
 * A listener of binding changes: called with the binding id after its content changed or it was
 * deleted, once the store file holds the change. A listener that invalidates grants answers the
 * automations it invalidated, which the delete route reports.
 */
export type BindingListener = (bindingId: string) => void | Promise<readonly string[] | void>;

/** The `hash` of a binding's content: SHA-256 over its canonical JSON. */
export function bindingHash(content: TargetBindingContent): string {
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

/**
 * Whether a URL's origin is one a browser binding allows; native bindings allow none. Both sides
 * compare as `URL.origin` normalizes them (lowercase host, default port dropped).
 */
export function originAllowed(binding: TargetBinding, url: string): boolean {
  if (binding.kind !== 'browser') return false;
  const origin = originOf(url);
  return origin !== null && binding.allowedOrigins.some((allowed) => originOf(allowed) === origin);
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The registered computer targets (`<dataDir>/computer/bindings.json`, a protected write root).
 * Only the shell-only bindings route writes content, from a host-prepared target; the renderer
 * lists and deletes. Every content change bumps `revision` and `hash`, which invalidates grants and
 * target refs that name the older revision. Changes are serialized and written atomically. A file
 * of any other version or a damaged one is never overwritten: the store then lists nothing and
 * refuses every change (`problem`), so computer use is unavailable until it is dealt with.
 */
export class ComputerBindingStore {
  private bindings: TargetBinding[];
  private readonly temporary = new Map<string, TargetBinding[]>();
  private readonly listeners = new Set<BindingListener>();
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly file: string,
    bindings: TargetBinding[],
    /** Why the stored file cannot be used; null when it loaded or was absent. */
    readonly problem: string | null = null,
  ) {
    this.bindings = bindings;
  }

  static async load(dataDir: string, log: Logger): Promise<ComputerBindingStore> {
    const file = path.join(dataDir, 'computer', 'bindings.json');
    let raw: unknown;
    let problem: string | null;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
      problem = fileProblem(raw);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return new ComputerBindingStore(file, []);
      problem =
        error instanceof SyntaxError
          ? 'The computer targets file is damaged.'
          : `The computer targets file cannot be read (${errorMessage(error)}).`;
    }
    if (problem) {
      log.error(`${problem} Computer use is unavailable; the file was left as it is.`, { file });
      return new ComputerBindingStore(file, [], problem);
    }
    return new ComputerBindingStore(file, parse(BindingsFileSchema, raw).bindings);
  }

  get(bindingId: string): TargetBinding | undefined {
    return (
      this.bindings.find((binding) => binding.bindingId === bindingId) ??
      [...this.temporary.values()].flat().find((binding) => binding.bindingId === bindingId)
    );
  }

  list(): TargetBinding[] {
    return [...this.bindings];
  }

  temporaryFor(runId: string): TargetBinding[] {
    return [...(this.temporary.get(runId) ?? [])];
  }

  /** Manual approvals never reach the durable bindings file or Settings. */
  saveTemporary(runId: string, content: TargetBindingContent): TargetBinding {
    const binding = parse(TargetBindingSchema, {
      ...content,
      bindingId: randomUUID(),
      revision: 1,
      hash: bindingHash(content),
    });
    this.temporary.set(runId, [...(this.temporary.get(runId) ?? []), binding]);
    return binding;
  }

  forgetTemporary(runId: string): void {
    this.temporary.delete(runId);
  }

  /** Registers a listener; the returned function removes it. */
  onChange(listener: BindingListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Registers a prepared target, or updates `bindingId` (404 unknown, 409 when `expectedRevision`
   * moved on). Unchanged content keeps revision and hash and notifies nobody.
   */
  save(request: SaveComputerBindingRequest): Promise<TargetBinding> {
    return this.serialized(async () => {
      this.writable();
      const hash = bindingHash(request.content);
      const current = request.bindingId ? this.get(request.bindingId) : undefined;
      if (request.bindingId && !current) throw new LedgerNotFound('Binding', request.bindingId);
      if (current && request.expectedRevision !== undefined)
        if (current.revision !== request.expectedRevision)
          throw new ConflictError(`Binding ${current.bindingId} changed since it was read.`);
      if (current && current.hash === hash) return current;
      if (!current && this.bindings.length >= COMPUTER_MAX_BINDINGS)
        throw new ConflictError(`At most ${COMPUTER_MAX_BINDINGS} computer targets can be saved.`);
      const binding = parse(TargetBindingSchema, {
        ...request.content,
        bindingId: current?.bindingId ?? randomUUID(),
        revision: (current?.revision ?? 0) + 1,
        hash,
      });
      const next = current
        ? this.bindings.map((item) => (item.bindingId === binding.bindingId ? binding : item))
        : [...this.bindings, binding];
      await this.write(next);
      if (current) await this.notify(binding.bindingId);
      return binding;
    });
  }

  /**
   * Deletes a binding (404 unknown) and answers the automations whose grants the listeners
   * invalidated. The file no longer lists it before any listener runs.
   */
  delete(bindingId: string): Promise<string[]> {
    return this.serialized(async () => {
      this.writable();
      if (!this.get(bindingId)) throw new LedgerNotFound('Binding', bindingId);
      await this.write(this.bindings.filter((binding) => binding.bindingId !== bindingId));
      return this.notify(bindingId);
    });
  }

  /** Whether a binding's content still hashes to `hash` (a grant's frozen binding hash). */
  matches(bindingId: string, hash: string): boolean {
    return this.get(bindingId)?.hash === hash;
  }

  private writable(): void {
    if (this.problem) throw new ConflictError(this.problem);
  }

  private async write(bindings: TargetBinding[]): Promise<void> {
    await atomicWrite(this.file, { version: BINDINGS_VERSION, bindings });
    this.bindings = bindings;
  }

  private async notify(bindingId: string): Promise<string[]> {
    const invalidated = new Set<string>();
    for (const listener of this.listeners) {
      const ids = await listener(bindingId);
      for (const id of ids ?? []) invalidated.add(id);
    }
    return [...invalidated];
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
