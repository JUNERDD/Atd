import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { parse, WpsSelectionEventSchema, type WpsSelectionEvent } from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { atomicWrite } from '../config.js';

const ConfigSchema = Type.Object(
  {
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    token: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { additionalProperties: false },
);
const SnapshotSchema = Type.Object(
  {
    requestId: Type.String({ pattern: '^[a-f0-9]{24}$' }),
    event: WpsSelectionEventSchema,
  },
  { additionalProperties: false },
);

/** A stalled page must not turn successive toolbar checks into an unbounded socket queue. */
function sendControl(
  response: ServerResponse,
  control: { enabled: boolean; disconnect?: boolean; requestId?: string; since?: number },
): boolean {
  if (response.destroyed || response.writableEnded) return false;
  const frame = `data: ${JSON.stringify(control)}\n\n`;
  if (response.writableLength + Buffer.byteLength(frame) > 4096 || !response.write(frame)) {
    response.destroy();
    return false;
  }
  return true;
}

/** Dedicated, loopback-only add-in transport in the existing service process. */
export class WpsSelectionTransport {
  onConnectionChange: (() => void) | undefined;
  private client: { instance: string; response: ServerResponse } | null = null;
  private latest: WpsSelectionEvent | null = null;
  private enabled = true;
  private sequence = 0;
  private pending: {
    id: string;
    finish: (snapshot: Static<typeof SnapshotSchema> | null) => void;
  } | null = null;
  private origin = '';
  private constructor(
    private readonly server: FastifyInstance,
    readonly token: string,
  ) {}

  static async open(
    dataDir: string,
    entries: Record<string, string>,
  ): Promise<WpsSelectionTransport> {
    const directory = path.join(dataDir, 'wps-selection');
    const file = path.join(directory, 'transport.json');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let configuration: Static<typeof ConfigSchema> | undefined;
    try {
      configuration = parse(ConfigSchema, JSON.parse(await readFile(file, 'utf8')));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const server = Fastify({
      logger: false,
      bodyLimit: 4096,
      requestTimeout: 3000,
      exposeHeadRoutes: false,
    });
    const transport = new WpsSelectionTransport(
      server,
      configuration?.token ?? randomBytes(32).toString('hex'),
    );
    await transport.routes(entries);
    try {
      transport.origin = await server.listen({ host: '127.0.0.1', port: configuration?.port ?? 0 });
      await atomicWrite(
        file,
        { token: transport.token, port: Number(new URL(transport.origin).port) },
        0o600,
      );
      return transport;
    } catch (error) {
      await server.close();
      throw error;
    }
  }

  get url(): string {
    return `${this.origin}/${this.token}/`;
  }
  get connected(): boolean {
    return this.client !== null;
  }
  get event(): WpsSelectionEvent | null {
    return this.latest;
  }

  /** One request in flight; WPS reads current content after the gesture, never a queued event. */
  snapshot(since: number): Promise<Static<typeof SnapshotSchema> | null> {
    if (!this.enabled || !this.client || this.pending) return Promise.resolve(null);
    const client = this.client;
    return new Promise((resolve) => {
      const id = randomBytes(12).toString('hex');
      const timer = setTimeout(() => this.pending?.id === id && this.pending.finish(null), 100);
      this.pending = {
        id,
        finish: (event) => {
          clearTimeout(timer);
          this.pending = null;
          resolve(event);
        },
      };
      if (!sendControl(client.response, { enabled: true, requestId: id, since }))
        this.pending?.finish(null);
    });
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.pending?.finish(null);
    if (this.latest) this.latest = { ...this.latest, kind: 'clear', hasContent: false };
    if (this.client) sendControl(this.client.response, { enabled });
  }

  async close(permanent = false): Promise<void> {
    this.setEnabled(false);
    if (permanent && this.client)
      sendControl(this.client.response, { enabled: false, disconnect: true });
    this.client?.response.end();
    this.client = null;
    this.latest = null;
    await this.server.close();
  }

  private async routes(entries: Record<string, string>): Promise<void> {
    const base = `/${this.token}`;
    const assets = new Map<string, { bytes: Buffer; mime: string }>();
    const hash = createHash('sha256');
    for (const [key, file, mime] of [
      ['index', 'index.html', 'text/html'],
      ['script', 'main.js', 'application/javascript'],
      ['ribbon', 'ribbon.xml', 'application/xml'],
    ]) {
      const entry = key ? entries[key] : undefined;
      if (!entry || !file || !mime) throw new Error('The WPS add-on is missing a required entry.');
      const bytes = await readFile(entry);
      if (bytes.length > 256 * 1024) throw new Error('The WPS add-on asset is too large.');
      hash.update(file).update(bytes);
      assets.set(`${base}/${file}`, { bytes, mime });
    }
    const revision = hash.digest('hex');
    const index = assets.get(`${base}/index.html`);
    const html = index?.bytes.toString('utf8');
    if (!index || !html?.includes('__ATD_SELECTION_REVISION__'))
      throw new Error('The WPS add-on page has no revision marker.');
    index.bytes = Buffer.from(html.replace('__ATD_SELECTION_REVISION__', revision));
    this.server.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      if (
        !this.origin ||
        request.headers.host !== new URL(this.origin).host ||
        (origin && origin !== 'null' && origin !== this.origin)
      )
        return reply.code(403).send();
      reply.header('cache-control', 'no-store');
      reply.header('x-content-type-options', 'nosniff');
      // WPS versions may host add-ins under an opaque origin. The unguessable path still
      // authenticates this page; never enable CORS for another web origin.
      if (origin) reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-headers', 'Content-Type');
    });
    for (const [route, asset] of assets)
      this.server.get(route, async (_request, reply) => reply.type(asset.mime).send(asset.bytes));
    this.server.get(`${base}/`, async (_request, reply) => reply.redirect(`${base}/index.html`));
    this.server.options(`${base}/selection`, async (_request, reply) => reply.code(204).send());
    this.server.get<{ Querystring: { instance?: string; revision?: string } }>(
      `${base}/control`,
      async (request, reply) => {
        const instance = request.query.instance;
        if (!instance || !/^[a-zA-Z0-9-]{1,80}$/.test(instance)) return reply.code(400).send();
        // A host keeps its old page in memory after an update. Keep the stable trusted URL,
        // but require the loaded assets to match before reporting a usable connection.
        if (request.query.revision !== revision)
          return reply
            .type('text/event-stream')
            .send('data: {"enabled":false,"disconnect":true}\n\n');
        if (this.client) sendControl(this.client.response, { enabled: false, disconnect: true });
        this.client?.response.end();
        this.pending?.finish(null);
        this.latest = null;
        this.sequence = 0;
        reply.hijack();
        const response = reply.raw;
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          ...(request.headers.origin
            ? { 'access-control-allow-origin': request.headers.origin }
            : {}),
        });
        this.client = { instance, response };
        this.onConnectionChange?.();
        sendControl(response, { enabled: this.enabled });
        response.on('close', () => {
          if (this.client?.response === response) {
            this.client = null;
            this.pending?.finish(null);
            if (this.latest) this.latest = { ...this.latest, kind: 'clear', hasContent: false };
            this.onConnectionChange?.();
          }
        });
      },
    );
    this.server.post(`${base}/selection`, async (request, reply) => {
      let snapshot: Static<typeof SnapshotSchema>;
      try {
        snapshot = parse(SnapshotSchema, request.body);
      } catch {
        return reply.code(400).send();
      }
      const { event, requestId } = snapshot;
      if (
        !this.enabled ||
        event.instance !== this.client?.instance ||
        requestId !== this.pending?.id
      )
        return reply.code(409).send();
      if (event.sequence < this.sequence || event.occurredAt > Date.now() + 50)
        return reply.code(409).send();
      this.sequence = event.sequence;
      this.latest = event;
      this.pending.finish(snapshot);
      return reply.code(204).send();
    });
  }
}
