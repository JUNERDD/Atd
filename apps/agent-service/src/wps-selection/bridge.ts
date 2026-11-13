import type { FastifyInstance } from 'fastify';
import { WPS_SELECTION_ADDON, type WpsSelectionState } from '@atd/agent-contracts';
import type { AddonRegistry } from '../addons/registry.js';
import type { SettingsStore } from '../settings/store.js';
import { invalidateOffRoute } from '../invalidate.js';
import { RENDERER_ROUTE, SHELL_ROUTE } from '../relay-routes.js';
import { registerWpsSelection } from './registration.js';
import { WpsSelectionTransport } from './transport.js';

/** Owns one optional WPS connection. Removal disconnects it and removes only our registration. */
class WpsSelectionBridge {
  private transport: WpsSelectionTransport | null = null;
  private activeRoot: string | null = null;
  private error: string | null = null;
  private changing: Promise<void> | null = null;
  private dirty = false;
  private stopping = false;

  constructor(
    private readonly dataDir: string,
    private readonly addons: AddonRegistry,
    private readonly settings: SettingsStore,
    private readonly changed: () => void,
  ) {}

  state(): WpsSelectionState {
    return {
      installed: this.addons.installed(WPS_SELECTION_ADDON) !== undefined,
      connected: this.transport?.connected ?? false,
      sampled: false,
      requestId: null,
      error: this.error,
      event: this.transport?.event ?? null,
    };
  }

  async sample(since: number): Promise<WpsSelectionState> {
    const snapshot = await this.transport?.snapshot(since);
    return {
      ...this.state(),
      sampled: snapshot != null,
      requestId: snapshot?.requestId ?? null,
      event: snapshot?.event ?? this.transport?.event ?? null,
    };
  }

  refresh(reconnect = false): Promise<void> {
    if (reconnect) this.activeRoot = null;
    this.dirty = true;
    if (this.changing) return this.changing;
    this.changing = this.reconcile().finally(() => {
      this.changing = null;
    });
    return this.changing;
  }

  updateEnabled(): void {
    const value = this.settings.current().settings.selectionToolbar;
    this.transport?.setEnabled(
      value.enabled &&
        !value.excludedApps.some((app) => app.bundleId === 'com.kingsoft.wpsoffice.mac'),
    );
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.changing;
    await this.transport?.close();
    this.transport = null;
  }

  private async reconcile(): Promise<void> {
    while (this.dirty && !this.stopping) {
      this.dirty = false;
      const installed = this.addons.installed(WPS_SELECTION_ADDON);
      if (installed?.root === this.activeRoot && this.transport) continue;
      await this.transport?.close(!installed);
      this.transport = null;
      this.activeRoot = null;
      this.error = null;
      try {
        if (installed) {
          const transport = await WpsSelectionTransport.open(this.dataDir, installed.entries);
          this.transport = transport;
          if (this.stopping) {
            await transport.close();
            this.transport = null;
            return;
          }
          await registerWpsSelection(this.dataDir, transport.url);
          transport.onConnectionChange = this.changed;
          this.activeRoot = installed.root;
          this.updateEnabled();
        } else {
          await registerWpsSelection(this.dataDir, null);
        }
      } catch {
        await this.transport?.close();
        this.transport = null;
        this.error = 'The WPS integration could not be set up. Open WPS once, then try again.';
      }
      this.changed();
    }
  }
}

export function registerWpsSelectionRoutes(
  app: FastifyInstance,
  deps: { dataDir: string; addons: AddonRegistry; settings: SettingsStore },
): void {
  const bridge = new WpsSelectionBridge(deps.dataDir, deps.addons, deps.settings, () =>
    invalidateOffRoute(app, { type: 'invalidate', scope: 'addons' }),
  );
  const stop = deps.addons.onChange(() => {
    void bridge.refresh();
  });
  app.addHook('onReady', async () => {
    void bridge.refresh();
  });
  app.addHook('onClose', async () => {
    stop();
    await bridge.stop();
  });
  app.addHook('onResponse', async (request, reply) => {
    if (
      reply.statusCode < 300 &&
      request.method !== 'GET' &&
      (request.url.startsWith('/v1/settings') || request.url.startsWith('/v1/development'))
    )
      bridge.updateEnabled();
  });
  app.get<{ Querystring: { since?: string } }>(
    '/v1/integrations/wps-selection',
    SHELL_ROUTE,
    async (request, reply) => {
      const since = Number(request.query.since);
      if (!Number.isSafeInteger(since) || since < 0) return reply.code(400).send();
      return bridge.sample(since);
    },
  );
  app.get('/v1/integrations/wps-selection/status', RENDERER_ROUTE, async () => {
    const { event: _event, sampled: _sampled, requestId: _requestId, ...status } = bridge.state();
    return status;
  });
  app.post('/v1/integrations/wps-selection/reconnect', RENDERER_ROUTE, async () => {
    await bridge.refresh(true);
    const { event: _event, sampled: _sampled, requestId: _requestId, ...status } = bridge.state();
    return status;
  });
}
