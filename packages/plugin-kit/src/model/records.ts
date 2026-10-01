import { Type, type Static } from 'typebox';
import { PluginDiagnosticSchema, type PluginDiagnostic } from './diagnostics.js';
import {
  NormalizedPluginSchema,
  PluginSourceSpecSchema,
  ResolvedSourceSchema,
  type ComponentKind,
  type PluginFormat,
  type PluginManifest,
  type PluginSourceSpec,
  type UserConfigValue,
} from './manifest.js';

/**
 * One installed plugin revision as the registry stores it. `id` is the manifest name, which is
 * unique per registry. `revision` is the content hash of the published directory, so equal
 * content always has the same revision.
 */
export const InstalledPluginSchema = Type.Object(
  {
    id: Type.String(),
    source: PluginSourceSpecSchema,
    resolved: ResolvedSourceSchema,
    revision: Type.String({ pattern: '^[0-9a-f]{16,64}$' }),
    plugin: NormalizedPluginSchema,
    installedAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type InstalledPlugin = Static<typeof InstalledPluginSchema>;

/** Registry file (`registry.json`). */
export const PluginRegistryFileSchema = Type.Object(
  { version: Type.Literal(1), plugins: Type.Array(InstalledPluginSchema) },
  { additionalProperties: false },
);
export type PluginRegistryFile = Static<typeof PluginRegistryFileSchema>;

/**
 * User state (`state.json`), shared by host and installed plugins and kept across updates.
 * `items` keys are `<kind>:<local item name>`. Sensitive config values are never stored here.
 */
export const PluginStateFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    /** Plugin ids the user turned off. Installed plugins start in this list. */
    disabled: Type.Array(Type.String()),
    /** Per plugin: item keys the user turned off. */
    items: Type.Record(Type.String(), Type.Array(Type.String())),
    /** Per plugin: non-sensitive user config values. */
    config: Type.Record(
      Type.String(),
      Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
    ),
    /**
     * Legacy, never written: per plugin, the stdio MCP server names approved before the service
     * took over launch approvals. The service reads it only to know that a one-time re-approval
     * notice is due; its presence approves nothing.
     */
    approved: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
  },
  { additionalProperties: false },
);
export type PluginStateFile = Static<typeof PluginStateFileSchema>;

/** Kinds a host plugin may list. `memory` exists only on host plugins. */
export type PluginItemKind = ComponentKind | 'memory';

/** An item a host-owned plugin exposes: the host decides membership and its own item state. */
export interface HostPluginItem {
  kind: PluginItemKind;
  name: string;
  /** The host's own per-item switch (for example a disabled skill or command). */
  enabled: boolean;
}

/**
 * A plugin the host synthesizes from its own stores (built-ins, personal items, shared folders).
 * Host plugins are never installed, updated or removed by the kit; their items stay unqualified.
 */
export interface HostPlugin {
  id: string;
  name: string;
  description: string;
  /** Whether the user may turn the whole plugin off. */
  toggleable: boolean;
  items: HostPluginItem[];
}

/** One item after resolution: its qualified name and why it is (not) effective. */
export interface ResolvedItem {
  pluginId: string;
  kind: PluginItemKind;
  /** Item name inside its plugin. */
  localName: string;
  /** `<plugin>:<item>` for installed plugins, bare for host plugins. */
  name: string;
  /** The item's own switch. */
  itemEnabled: boolean;
  /** Plugin on, item on, and nothing below blocks it. */
  enabled: boolean;
  /** First reason the item is not effective, in precedence order. */
  blockedBy?: 'plugin' | 'item' | 'config' | 'collision';
}

export interface ResolvedPlugin {
  id: string;
  origin: 'host' | 'installed';
  name: string;
  displayName?: string;
  description: string;
  version?: string;
  format?: PluginFormat;
  source?: PluginSourceSpec;
  revision?: string;
  license?: string;
  installedAt?: string;
  enabled: boolean;
  toggleable: boolean;
  removable: boolean;
  updatable: boolean;
  needsConfig: boolean;
  counts: Record<PluginItemKind, number>;
  diagnostics: PluginDiagnostic[];
}

export interface ResolvedCatalog {
  plugins: ResolvedPlugin[];
  items: ResolvedItem[];
}

/** What a run froze: the plugin revisions it may read and the effective items by kind. */
export interface PluginRunSnapshot {
  plugins: { id: string; revision: string }[];
  items: Record<PluginItemKind, string[]>;
}

/** A fetched, normalized bundle waiting for the user to confirm installation. */
export interface InstallPreview {
  previewId: string;
  expiresAt: string;
  source: PluginSourceSpec;
  resolved: Static<typeof ResolvedSourceSchema>;
  revision: string;
  plugin: {
    format: PluginFormat;
    manifest: PluginManifest;
  } & Omit<Static<typeof NormalizedPluginSchema>, 'format' | 'manifest'>;
  /** Set when a plugin with this id is already installed: confirming updates it. */
  existing?: { revision: string; source: PluginSourceSpec };
  /** Executables and endpoints the user should review before confirming. */
  review: {
    stdio: { name: string; command: string; args: string[] }[];
    urls: { name: string; url: string }[];
    scripts: string[];
  };
}

export type ConfigValues = Record<string, UserConfigValue>;
export { PluginDiagnosticSchema };
