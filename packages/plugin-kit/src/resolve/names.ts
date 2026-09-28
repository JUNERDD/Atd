import { formatQualifiedName } from '../model/names.js';
import type { InstalledPlugin } from '../model/records.js';

/**
 * The name an installed plugin's item is known by everywhere else. Items are qualified
 * (`<plugin>:<item>`) so plugins cannot shadow each other or host items. A `skill`-format plugin is
 * a single Agent Skills folder installed on its own: its one skill keeps its bare name, as it had
 * before plugins existed, and competes for that name under the ordinary collision rules. Hosts must
 * find an item's plugin through the item's `pluginId`, never by parsing this name.
 */
export function installedItemName(
  installed: Pick<InstalledPlugin, 'id' | 'plugin'>,
  localName: string,
): string {
  return installed.plugin.format === 'skill'
    ? localName
    : formatQualifiedName({ plugin: installed.id, item: localName });
}
