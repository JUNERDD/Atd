import {
  configurePlugin,
  duplicatePluginItem,
  getPlugin,
  installPlugin,
  listPlugins,
  previewPlugin,
  previewPluginUpdate,
  setPluginEnabled,
  setPluginItemEnabled,
  uninstallPlugin,
  type AgentClientOptions,
} from '@ai/agent-client';
import {
  PluginConfigRequestSchema,
  PluginIdSchema,
  PluginInstallRequestSchema,
  PluginItemKindSchema,
  PluginPreviewRequestSchema,
  type PluginConfigRequest,
  type PluginItemKind,
  type PluginPreviewRequest,
} from '@ai/agent-contracts';
import { Type, type Static } from 'typebox';

/** An item's name inside its plugin, as the plugin routes take it. */
const ItemNameSchema = Type.String({ minLength: 1, maxLength: 256 });

/**
 * Plugin actions of the service bridge. The main process validates them here (as part of
 * `ServiceRequestSchema`) before any value reaches a service URL; the contract schemas bound the
 * id, kind, config values and install source.
 */
export const PluginRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('plugins') }, { additionalProperties: false }),
  Type.Object(
    { action: Type.Literal('pluginsGet'), id: PluginIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('pluginsSetEnabled'), id: PluginIdSchema, enabled: Type.Boolean() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('pluginsSetItemEnabled'),
      id: PluginIdSchema,
      kind: PluginItemKindSchema,
      name: ItemNameSchema,
      enabled: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('pluginsConfigure'),
      id: PluginIdSchema,
      values: PluginConfigRequestSchema.properties.values,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('pluginsDuplicate'),
      id: PluginIdSchema,
      kind: PluginItemKindSchema,
      name: ItemNameSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('pluginsPreview'),
      source: PluginPreviewRequestSchema.properties.source,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('pluginsUpdatePreview'), id: PluginIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('pluginsInstall'),
      previewId: PluginInstallRequestSchema.properties.previewId,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('pluginsUninstall'), id: PluginIdSchema },
    { additionalProperties: false },
  ),
]);
export type PluginRequest = Static<typeof PluginRequestSchema>;

/**
 * The plugin half of the service bridge. Answers cross IPC as plain data, so the renderer
 * validates each DTO against the contract schemas (`plugin-rows.ts`) instead of trusting a cast.
 */
export interface ServicePluginBridge {
  /** `PluginListResponse`: every host and installed plugin. */
  plugins: () => Promise<{ plugins: unknown[] }>;
  /** `PluginDetail` of one plugin. */
  plugin: (id: string) => Promise<unknown>;
  /** Turns a toggleable plugin on or off; answers its `PluginDetail`. */
  setPluginEnabled: (id: string, enabled: boolean) => Promise<unknown>;
  /** Turns one item of a plugin on or off; answers the plugin's `PluginDetail`. */
  setPluginItemEnabled: (input: {
    id: string;
    kind: PluginItemKind;
    name: string;
    enabled: boolean;
  }) => Promise<unknown>;
  /** Saves user config values (`null` clears one); answers the `PluginDetail`. */
  configurePlugin: (id: string, values: PluginConfigRequest['values']) => Promise<unknown>;
  /** Copies an item into Personal; answers `PluginDuplicateResponse`. */
  duplicatePluginItem: (input: {
    id: string;
    kind: PluginItemKind;
    name: string;
  }) => Promise<unknown>;
  /** Fetches a bundle and answers its `PluginInstallPreview`; nothing is installed yet. */
  previewPlugin: (source: PluginPreviewRequest['source']) => Promise<unknown>;
  /** Re-fetches an installed plugin's source; answers the `PluginInstallPreview` of the update. */
  previewPluginUpdate: (id: string) => Promise<unknown>;
  /** Installs (or updates) from a preview; answers the plugin's `PluginDetail`. */
  installPlugin: (previewId: string) => Promise<unknown>;
  uninstallPlugin: (id: string) => Promise<{ removed: true }>;
}

/** Runs one validated plugin action against the service. */
export function handlePluginRequest(
  options: AgentClientOptions,
  request: PluginRequest,
): Promise<unknown> {
  switch (request.action) {
    case 'plugins':
      return listPlugins(options);
    case 'pluginsGet':
      return getPlugin(options, request.id);
    case 'pluginsSetEnabled':
      return setPluginEnabled(options, request.id, request.enabled);
    case 'pluginsSetItemEnabled':
      return setPluginItemEnabled(options, {
        id: request.id,
        kind: request.kind,
        name: request.name,
        enabled: request.enabled,
      });
    case 'pluginsConfigure':
      return configurePlugin(options, request.id, request.values);
    case 'pluginsDuplicate':
      return duplicatePluginItem(options, {
        id: request.id,
        kind: request.kind,
        name: request.name,
      });
    case 'pluginsPreview':
      return previewPlugin(options, request.source);
    case 'pluginsUpdatePreview':
      return previewPluginUpdate(options, request.id);
    case 'pluginsInstall':
      return installPlugin(options, request.previewId);
    case 'pluginsUninstall':
      return uninstallPlugin(options, request.id);
    default: {
      const _exhaustive: never = request;
      throw new Error(`Unsupported plugin action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
