import { getSettings, patchSettings } from '@ai/agent-client';
import type { PatchSettingsRequest, UserSettings } from '@ai/agent-contracts';
import type { ServiceConnection } from './service/connection';

export type SharedSetting = 'language' | 'permissionTier' | 'shellAllowlist' | 'shortcuts';

/**
 * Keeps the settings every client shares equal to the service's copy. The desktop also caches
 * them in its settings file, so it can apply the language and the global shortcut before the
 * service is up. Local edits are marked dirty and pushed now, or on the next connection when
 * the service is away; edits made by another client arrive as a `settings` invalidation. The
 * first connection to a service without settings seeds it from this cache once.
 */
export class ServiceSettingsSync {
  private connection: ServiceConnection | null = null;
  private readonly dirty = new Set<SharedSetting>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly local: () => UserSettings,
    private readonly adopt: (settings: UserSettings) => Promise<void>,
  ) {}

  attach(connection: ServiceConnection) {
    this.connection = connection;
    connection.onConnected(() => this.schedule(() => this.reconcile()));
    connection.onInvalidate((frame) => {
      if (frame.scope === 'settings') this.schedule(() => this.pull());
    });
    this.schedule(() => this.reconcile());
  }

  /** Records local edits; they reach the service now, or when it is next connected. */
  changed(fields: SharedSetting[]) {
    for (const field of fields) this.dirty.add(field);
    this.schedule(() => this.push());
  }

  /** Runs sync steps one at a time; a failed step is logged and retried by the next trigger. */
  private schedule(step: () => Promise<void>) {
    this.chain = this.chain.then(step).catch((error: unknown) => {
      console.warn('Could not sync settings with the agent service:', error);
    });
  }

  private async reconcile() {
    const options = this.connection?.options();
    if (!options) return;
    const current = await getSettings(options);
    if (!current.initialized) {
      const seeded = await patchSettings(options, { ...this.local(), onlyIfUninitialized: true });
      this.dirty.clear();
      return this.adopt(seeded.settings);
    }
    if (this.dirty.size) return this.push();
    return this.adopt(current.settings);
  }

  private async pull() {
    const options = this.connection?.options();
    if (!options) return;
    await this.adopt((await getSettings(options)).settings);
  }

  private async push() {
    const options = this.connection?.options();
    if (!options || !this.dirty.size) return;
    const local = this.local();
    const fields = [...this.dirty];
    const request: PatchSettingsRequest = {};
    for (const field of fields) Object.assign(request, { [field]: local[field] });
    this.dirty.clear();
    try {
      await this.adopt((await patchSettings(options, request)).settings);
    } catch (error) {
      for (const field of fields) this.dirty.add(field);
      throw error;
    }
  }
}
