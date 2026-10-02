import { errorMessage, type McpHttpAuth, type McpServerConfig } from '@ai/agent-contracts';
import { KeyringBackend, keyringMcpAccount } from '../credentials/keyring.js';
import type { Logger } from '../logging.js';
import { McpError } from './errors.js';
import {
  clientSecretAccount,
  KEYRING_REF,
  readStoredServers,
  secretAccount,
  writeStoredServers,
  type SecretKind,
  type StoredAuth,
  type StoredServer,
  type StoredValue,
  type StoredValues,
} from './server-file.js';
import { credentialIdentity, parseServerConfigs } from './servers.js';

/** Plugin listings read the stored servers without touching the keyring (plugins/host-plugins.ts). */
export { readStoredServers, secretAccount, type StoredServer } from './server-file.js';

/**
 * The user's MCP servers at rest. `servers.json` keeps each server with the NAMES of its stdio env
 * and HTTP header entries (server-file.ts); the OS keyring keeps their values, one account per
 * entry (`mcp:<serverKey>:env:<NAME>`, `mcp:<serverKey>:header:<Name>`, credentials/keyring.ts),
 * and an OAuth client secret under `mcp:<serverKey>:oauth-client-secret`. The
 * server key derives from the service, the server id and its principal, none of which an edit can
 * change, so an entry keeps its account until its name or server goes away. A value stays in plain
 * text only where no keyring could take it (secrets-migration.ts). Loading hydrates full records,
 * so everything that connects keeps reading complete env and header values.
 *
 * Invariants:
 * - The file never names a keyring value that was not written first: a save writes the values
 *   that changed, then the file, and only then deletes the values the file no longer names.
 * - A save that fails before its file is written puts back the keyring values it had changed.
 * - Removing a server, or moving it off bearer auth, deletes its bearer token as well.
 * - A value missing from the keyring at load turns its server off without that name, with a
 *   warning; a keyring that cannot be read at all fails the load and changes nothing.
 */

/** A keyring value a failed save changed, and what it held before (undefined: nothing). */
interface Written {
  account: string;
  before: string | undefined;
}

/** What one save has written, named and left in plain text so far. */
interface SaveState {
  written: Written[];
  named: Set<string>;
  plain: Map<string, string>;
}

export class McpServerStore {
  /** The values the keyring holds for the saved servers, by account, as last read or written. */
  private readonly held = new Map<string, string>();
  /** The values the file still keeps in plain text, by account. */
  private plain = new Map<string, string>();
  /** The saved servers' bearer token accounts, and whether each server uses bearer auth. */
  private saved = new Map<string, { bearerAccount: string; bearer: boolean }>();
  /** Saves run one at a time, so each sees the keyring as the previous one left it. */
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly dataDir: string,
    private readonly serviceId: string,
    private readonly log: Logger,
    private readonly keyring: KeyringBackend,
  ) {}

  /** Reads `servers.json` and hydrates every keyring value into full records. */
  static async load(
    dataDir: string,
    serviceId: string,
    log: Logger,
  ): Promise<{ store: McpServerStore; records: McpServerConfig[] }> {
    const store = new McpServerStore(dataDir, serviceId, log, new KeyringBackend(serviceId));
    const records: McpServerConfig[] = [];
    for (const server of await readStoredServers(dataDir))
      records.push(await store.hydrate(server));
    store.remember(records);
    return { store, records: parseServerConfigs({ servers: records }) };
  }

  /** Persists the user's servers as a whole (see the invariants above). */
  save(next: McpServerConfig[]): Promise<void> {
    const run = this.queue.then(() => this.write(next));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async hydrate(server: StoredServer): Promise<McpServerConfig> {
    const missing: string[] = [];
    const value = async (account: string, stored: StoredValue, label: string) => {
      if (typeof stored === 'string') {
        this.plain.set(account, stored);
        return stored;
      }
      const held = await this.read(account);
      if (held === undefined) missing.push(label);
      else this.held.set(account, held);
      return held;
    };
    const values = async (kind: SecretKind, stored: StoredValues) => {
      const out: Record<string, string> = {};
      for (const [name, entry] of Object.entries(stored)) {
        const account = secretAccount(this.serviceId, server, kind, name);
        const held = await value(account, entry, `${kind}:${name}`);
        if (held !== undefined) out[name] = held;
      }
      return out;
    };
    const auth = async (stored: StoredAuth): Promise<McpHttpAuth> => {
      if (stored.type !== 'oauth') return stored;
      const { clientSecret, ...rest } = stored;
      if (clientSecret === undefined) return rest;
      const account = clientSecretAccount(this.serviceId, server);
      const held = await value(account, clientSecret, 'oauth:clientSecret');
      return held === undefined ? rest : { ...rest, clientSecret: held };
    };
    const { stdio, http } = server;
    const record: McpServerConfig = {
      ...server,
      exposure: server.exposure ?? 'auto',
      stdio: stdio && { ...stdio, env: await values('env', stdio.env) },
      http: http && {
        ...http,
        headers: await values('header', http.headers),
        auth: await auth(http.auth),
      },
    };
    if (!missing.length) return record;
    this.log.warn(
      'Saved MCP server values are missing from the OS keyring; the server stays off until they are sent again.',
      { serverId: server.serverId, missing },
    );
    return { ...record, disabled: true };
  }

  private async read(account: string): Promise<string | undefined> {
    try {
      return await this.keyring.get(account);
    } catch (error) {
      throw new Error(
        `Saved MCP servers could not be loaded: the OS keyring could not be read (${errorMessage(error)}). servers.json and the keyring are unchanged.`,
      );
    }
  }

  private remember(records: readonly McpServerConfig[]): void {
    this.saved = new Map(
      records.map((record) => [
        record.serverId,
        {
          bearerAccount: keyringMcpAccount(credentialIdentity(this.serviceId, record)),
          bearer: record.http?.auth.type === 'bearer',
        },
      ]),
    );
  }

  private async write(next: McpServerConfig[]): Promise<void> {
    const written: Written[] = [];
    const named = new Set<string>();
    const plain = new Map<string, string>();
    try {
      const servers: StoredServer[] = [];
      for (const record of next) {
        const save = { written, named, plain };
        const stash = (kind: SecretKind, values: Record<string, string>) =>
          this.stash(record, kind, values, save);
        const { stdio, http } = record;
        servers.push({
          ...record,
          stdio: stdio && { ...stdio, env: await stash('env', stdio.env) },
          http: http && {
            ...http,
            headers: await stash('header', http.headers),
            auth: await this.stashAuth(record, http.auth, save),
          },
        });
      }
      await writeStoredServers(this.dataDir, servers);
    } catch (error) {
      await this.restore(written);
      throw error;
    }
    this.plain = plain;
    await this.prune(next, named);
    this.remember(next);
  }

  /** One env or header map as stored (see `stashValue`). */
  private async stash(
    server: Pick<McpServerConfig, 'serverId' | 'principal'>,
    kind: SecretKind,
    values: Record<string, string>,
    save: SaveState,
  ): Promise<StoredValues> {
    const what = kind === 'env' ? 'environment variable' : 'header';
    const stored: StoredValues = {};
    for (const [name, value] of Object.entries(values)) {
      const account = secretAccount(this.serviceId, server, kind, name);
      stored[name] = await this.stashValue(
        server.serverId,
        account,
        value,
        `${what} "${name}"`,
        save,
      );
    }
    return stored;
  }

  /** The auth as stored: an OAuth client secret goes to the keyring like a header value. */
  private async stashAuth(
    server: Pick<McpServerConfig, 'serverId' | 'principal'>,
    auth: McpHttpAuth,
    save: SaveState,
  ): Promise<StoredAuth> {
    if (auth.type !== 'oauth' || auth.clientSecret === undefined) return auth;
    const account = clientSecretAccount(this.serviceId, server);
    const { serverId } = server;
    const what = 'OAuth client secret';
    return {
      ...auth,
      clientSecret: await this.stashValue(serverId, account, auth.clientSecret, what, save),
    };
  }

  /** One value as stored: an unchanged plain value stays, everything else is written. */
  private async stashValue(
    serverId: string,
    account: string,
    value: string,
    what: string,
    save: SaveState,
  ): Promise<StoredValue> {
    const before = this.held.get(account);
    if (before !== value && this.plain.get(account) === value) {
      // The startup migration moves it once a keyring is there; a save never has to.
      save.plain.set(account, value);
      return value;
    }
    if (before !== value) {
      try {
        await this.keyring.set(account, value);
      } catch (error) {
        throw new McpError(
          'internal',
          serverId,
          `MCP server ${serverId} was not saved: its ${what} could not be stored in the OS keyring (${errorMessage(error)}).`,
        );
      }
      save.written.push({ account, before });
      this.held.set(account, value);
    }
    save.named.add(account);
    return KEYRING_REF;
  }

  /** Puts back what a failed save wrote; a value that cannot be put back is no longer trusted. */
  private async restore(written: readonly Written[]): Promise<void> {
    for (const { account, before } of [...written].reverse()) {
      try {
        if (before === undefined) await this.keyring.delete(account);
        else await this.keyring.set(account, before);
        if (before === undefined) this.held.delete(account);
        else this.held.set(account, before);
      } catch (error) {
        this.held.delete(account);
        this.log.warn('An MCP keyring value could not be restored after a failed save.', {
          account,
          error: errorMessage(error),
        });
      }
    }
  }

  /**
   * Deletes what the saved file no longer names: dropped values, and every entry and the bearer
   * token of a removed server (listed from the keyring, so leftovers of earlier failures go too)
   * or of one that left bearer auth. A failed delete leaves an entry nothing reads; it is logged.
   */
  private async prune(next: readonly McpServerConfig[], named: ReadonlySet<string>): Promise<void> {
    const stale = new Set([...this.held.keys()].filter((account) => !named.has(account)));
    const nextById = new Map(next.map((record) => [record.serverId, record]));
    const removed: string[] = [];
    for (const [serverId, old] of this.saved) {
      const now = nextById.get(serverId);
      if (!now) removed.push(old.bearerAccount);
      if (!now || (old.bearer && now.http?.auth.type !== 'bearer')) stale.add(old.bearerAccount);
    }
    if (removed.length) {
      for (const account of await this.keyring.listAccounts()) {
        if (removed.some((prefix) => account.startsWith(`${prefix}:`))) stale.add(account);
      }
    }
    for (const account of stale) {
      this.held.delete(account);
      try {
        await this.keyring.delete(account);
      } catch (error) {
        this.log.warn('An MCP keyring value the saved servers no longer name was not deleted.', {
          account,
          error: errorMessage(error),
        });
      }
    }
  }
}
