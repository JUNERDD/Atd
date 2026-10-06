import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  parse,
  PluginConfigRequestSchema,
  PluginEnabledRequestSchema,
  PluginIdSchema,
  PluginInstallRequestSchema,
  PluginItemKindSchema,
  PluginPreviewRequestSchema,
  type PluginDetail,
  type PluginInstallPreview,
  type PluginListResponse,
} from '@atd/agent-contracts';
import { InvalidPluginError, PathEscapeError, type InstallPreview } from '@atd/plugin-kit';
import {
  FetchLimitError,
  PluginConfigError,
  PluginConflictError,
  PluginStoreError,
} from '@atd/plugin-kit/node';
import { Type } from 'typebox';
import { CommandStore } from '../commands/store.js';
import { ConflictError } from '../errors.js';
import type { Logger } from '../logging.js';
import { McpAuthority } from '../mcp/index.js';
import { logMemoryEvents, MemoryAuthority } from '../memory/index.js';
import { findInstalled, findPlugin, pluginDetail, toSummary } from './detail.js';
import { duplicateItem } from './duplicate.js';
import { PluginHost } from './host.js';
import { HOST_PLUGIN_IDS } from './host-plugins.js';
import { collectRenderedSkills } from './rendered.js';
import { setItemEnabled, setPluginEnabled, type PluginActions } from './toggle.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

export interface PluginRouteContext {
  dataDir: string;
  agentDir: string;
  log: Logger;
  /** The lazily loaded MCP authority (server.ts); only Personal MCP switches and copies load it. */
  mcp: () => Promise<McpAuthority>;
}

const ItemName = Type.String({ minLength: 1, maxLength: 256 });
const Params = {
  id: Type.Object({ id: PluginIdSchema }),
  item: Type.Object({ id: PluginIdSchema, kind: PluginItemKindSchema, name: ItemName }),
};

/**
 * Installer failures as HTTP errors: a same-id plugin from another source is a conflict (409); a
 * bundle, path, limit or config value problem is the request's (400), and so is any other
 * failure while fetching or publishing a source the request named (`sourceProblem`). A corrupt
 * registry or state file stays a 500.
 */
function translate(error: unknown, sourceProblem: string | null): never {
  if (error instanceof PluginConflictError) throw new ConflictError(error.message);
  if (!(error instanceof Error) || error instanceof PluginStoreError) throw error;
  if (
    error instanceof InvalidPluginError ||
    error instanceof PathEscapeError ||
    error instanceof FetchLimitError ||
    error instanceof PluginConfigError
  )
    throw new TypeError(`Invalid plugin: ${error.message}`);
  if (sourceProblem) throw new TypeError(`${sourceProblem}: ${error.message}`);
  throw error;
}

/**
 * A fetched preview, refused when the bundle claims a host plugin's id. A refused preview's id is
 * never handed out, so an install cannot reach it (installer.install is never called for it).
 */
async function checkedPreview(preview: Promise<InstallPreview>): Promise<PluginInstallPreview> {
  const result = await preview.catch((error: unknown) =>
    translate(error, 'The plugin could not be fetched'),
  );
  if (HOST_PLUGIN_IDS.includes(result.plugin.manifest.name))
    throw new TypeError(
      `Invalid plugin: "${result.plugin.manifest.name}" is the name of a built-in plugin.`,
    );
  return result;
}

/**
 * `/v1/plugins` (agent-contracts plugins.ts). Every mutation reloads the MCP authority's plugin
 * layer and announces a command-list change; install, update, configure and uninstall also
 * collect rendered skill bodies nothing references any more (plugins/rendered.ts); the `extensions` invalidation comes from
 * invalidate.ts, and memory switches also announce `memory` there.
 */
export function registerPluginRoutes(app: FastifyInstance, ctx: PluginRouteContext): void {
  const host = () => PluginHost.for(ctx.dataDir, ctx.log);
  // Start the host (and the one-time legacy migration) with the service, not on first use; the
  // service's stop awaits it (`PluginHost.closeFor`).
  void host().catch((error: unknown) =>
    ctx.log.warn('Plugins could not be prepared.', { error: String(error) }),
  );
  const actions = async (): Promise<PluginActions> => {
    const plugins = await host();
    return {
      host: plugins,
      view: await plugins.view(),
      memory: () => MemoryAuthority.authorityFor(ctx.agentDir, logMemoryEvents(ctx.log)),
      mcp: ctx.mcp,
    };
  };
  const changed = async (): Promise<void> => {
    await McpAuthority.refreshPlugins(ctx.dataDir);
    CommandStore.announce(ctx.dataDir);
  };
  const detail = async (id: string): Promise<PluginDetail> => {
    const plugins = await host();
    return pluginDetail(plugins, await plugins.view(), id);
  };

  app.get('/v1/plugins', RENDERER_ROUTE, async (): Promise<PluginListResponse> => {
    const view = await (await host()).view();
    return { plugins: view.catalog.plugins.map((plugin) => toSummary(plugin)) };
  });
  app.get('/v1/plugins/:id', RENDERER_ROUTE, async (request) =>
    detail(parse(Params.id, request.params).id),
  );

  app.post('/v1/plugins/:id/enabled', RENDERER_ROUTE, async (request) => {
    const { id } = parse(Params.id, request.params);
    const { enabled } = parse(PluginEnabledRequestSchema, request.body);
    await setPluginEnabled(await actions(), id, enabled);
    await changed();
    return detail(id);
  });
  app.post('/v1/plugins/:id/items/:kind/:name/enabled', RENDERER_ROUTE, async (request) => {
    const { id, kind, name } = parse(Params.item, request.params);
    const { enabled } = parse(PluginEnabledRequestSchema, request.body);
    await setItemEnabled(await actions(), id, kind, name, enabled);
    await changed();
    return detail(id);
  });
  app.put('/v1/plugins/:id/config', RENDERER_ROUTE, async (request) => {
    const { id } = parse(Params.id, request.params);
    const { values } = parse(PluginConfigRequestSchema, request.body);
    const { host: plugins, view } = await actions();
    const installed = findInstalled(view, id);
    await plugins.installer
      .setConfig(id, installed.plugin.userConfig, values)
      .catch((error: unknown) => translate(error, null));
    await changed();
    await collectRenderedSkills(plugins);
    return detail(id);
  });
  app.post('/v1/plugins/:id/items/:kind/:name/duplicate', RENDERER_ROUTE, async (request) => {
    const { id, kind, name } = parse(Params.item, request.params);
    const result = await duplicateItem(await actions(), id, kind, name);
    await changed();
    return result;
  });

  app.post('/v1/plugins/preview', RENDERER_ROUTE, async (request) => {
    const { source } = parse(PluginPreviewRequestSchema, request.body);
    if (source.kind === 'local' && !path.isAbsolute(source.path))
      throw new TypeError('Invalid plugin source: a local folder must be an absolute path.');
    return checkedPreview((await host()).installer.preview(source));
  });
  app.post('/v1/plugins/:id/update/preview', RENDERER_ROUTE, async (request) => {
    const { id } = parse(Params.id, request.params);
    const plugins = await host();
    findInstalled(await plugins.view(), id);
    return checkedPreview(plugins.installer.previewUpdate(id));
  });
  app.post('/v1/plugins/install', RENDERER_ROUTE, async (request) => {
    const { previewId } = parse(PluginInstallRequestSchema, request.body);
    const plugins = await host();
    const installed = await plugins.installer
      .install(previewId)
      .catch((error: unknown) => translate(error, 'The plugin could not be installed'));
    await changed();
    await collectRenderedSkills(plugins);
    return detail(installed.id);
  });
  app.delete('/v1/plugins/:id', RENDERER_ROUTE, async (request) => {
    const { id } = parse(Params.id, request.params);
    const plugins = await host();
    const view = await plugins.view();
    findPlugin(view, id);
    findInstalled(view, id);
    await plugins.installer.uninstall(id);
    await changed();
    await collectRenderedSkills(plugins);
    return { removed: true as const };
  });
}
