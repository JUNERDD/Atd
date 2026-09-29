import { __setKeyringModuleForTests } from '../dist/credentials/keyring.js';

type Operation = 'set' | 'get' | 'delete';

/**
 * An in-memory stand-in for `@napi-rs/keyring`, installed through the keyring test seam so a test
 * never writes to the real OS keyring. `fail` makes chosen operations throw like an unavailable
 * keyring; `accounts` lists what one service namespace holds.
 */
export function installMemoryKeyring() {
  const items = new Map<string, Map<string, string>>();
  const state: { fail: (operation: Operation, account: string) => boolean } = {
    fail: () => false,
  };
  const namespace = (service: string) => {
    const found = items.get(service) ?? new Map<string, string>();
    items.set(service, found);
    return found;
  };
  const check = (operation: Operation, account: string) => {
    if (state.fail(operation, account)) throw new Error(`simulated keyring ${operation} failure`);
  };

  class AsyncEntry {
    private readonly service: string;
    private readonly account: string;

    constructor(service: string, account: string) {
      this.service = service;
      this.account = account;
    }

    async setPassword(password: string): Promise<void> {
      check('set', this.account);
      namespace(this.service).set(this.account, password);
    }

    async getPassword(): Promise<string | undefined> {
      check('get', this.account);
      return namespace(this.service).get(this.account);
    }

    async deleteCredential(): Promise<boolean> {
      check('delete', this.account);
      return namespace(this.service).delete(this.account);
    }
  }

  __setKeyringModuleForTests({
    AsyncEntry,
    findCredentialsAsync: async (service: string) =>
      [...namespace(service)].map(([account, password]) => ({ account, password })),
  });

  return {
    state,
    /** Every account one keyring service holds, with its value. */
    accounts: (serviceId: string) => new Map(namespace(`ai-agent-service:${serviceId}`)),
    set: (serviceId: string, account: string, value: string) =>
      namespace(`ai-agent-service:${serviceId}`).set(account, value),
    remove: (serviceId: string, account: string) =>
      namespace(`ai-agent-service:${serviceId}`).delete(account),
  };
}
