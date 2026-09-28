import { Type } from 'typebox';

/**
 * Plugin names follow Agent Plugins 1.0: 1–64 characters of `[a-z0-9.-]`, starting and ending
 * with a letter or digit, without `--` or `..`. Formats with looser rules (Claude plugins) are
 * normalized to this alphabet by their adapter, which reports the rename as a diagnostic.
 */
export const PLUGIN_NAME_PATTERN = '^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$';

/** Item names (skills, agents, commands, MCP servers) inside one plugin. */
export const ITEM_NAME_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$';

/**
 * `<plugin>:<item>` for items contributed by an installed plugin, or a bare `<item>` for items the
 * host owns. There is at most one separator: nested component paths are flattened by the adapter
 * (`commands/db/migrate.md` becomes `db-migrate`).
 */
export const QUALIFIED_NAME_PATTERN =
  '^(?:[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?:)?[A-Za-z0-9][A-Za-z0-9_-]{0,127}$';

export const PluginNameSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: PLUGIN_NAME_PATTERN,
});
export const ItemNameSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: ITEM_NAME_PATTERN,
});
export const QualifiedNameSchema = Type.String({
  minLength: 1,
  maxLength: 193,
  pattern: QUALIFIED_NAME_PATTERN,
});

const PLUGIN_NAME = new RegExp(PLUGIN_NAME_PATTERN);
const ITEM_NAME = new RegExp(ITEM_NAME_PATTERN);

/** A parsed qualified name; `plugin` is absent for host-owned items. */
export interface QualifiedName {
  plugin?: string;
  item: string;
}

/** Whether `name` is a valid plugin name, including the `--` / `..` exclusions. */
export function isPluginName(name: string): boolean {
  return PLUGIN_NAME.test(name) && !name.includes('--') && !name.includes('..');
}

/** Whether `name` is a valid unqualified item name. */
export function isItemName(name: string): boolean {
  return ITEM_NAME.test(name);
}

/** Reads `<plugin>:<item>` or `<item>`; returns null when either part is invalid. */
export function parseQualifiedName(value: string): QualifiedName | null {
  const separator = value.indexOf(':');
  if (separator === -1) return isItemName(value) ? { item: value } : null;
  const plugin = value.slice(0, separator);
  const item = value.slice(separator + 1);
  return isPluginName(plugin) && isItemName(item) ? { plugin, item } : null;
}

/** Writes the qualified form; host-owned items (no plugin) stay bare. */
export function formatQualifiedName(name: QualifiedName): string {
  return name.plugin === undefined ? name.item : `${name.plugin}:${name.item}`;
}

/**
 * Normalizes a free-form name (a Claude plugin name, a file path under `commands/`) to the item
 * alphabet: path separators and invalid characters become `-`, runs collapse, and the result is
 * trimmed to 128 characters. Returns null when nothing usable remains.
 */
export function toItemName(raw: string): string | null {
  const cleaned = raw
    .replace(/\.md$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 128);
  return isItemName(cleaned) ? cleaned : null;
}

/** Normalizes a free-form plugin name to the plugin alphabet, or null when nothing usable remains. */
export function toPluginName(raw: string): string | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64)
    .replace(/[.-]+$/g, '');
  return isPluginName(cleaned) ? cleaned : null;
}
