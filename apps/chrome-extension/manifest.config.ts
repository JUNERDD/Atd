import { defineManifest } from '@crxjs/vite-plugin';
import packageJson from './package.json' with { type: 'json' };
import { FLAVORS, type Flavor } from './flavors.ts';

/**
 * The extension manifest per flavor. Permissions are the minimum the channel needs: `debugger` for
 * tabs handed to a task (never others), `tabs` and `tabGroups` for the "Atd" group, `scripting` to
 * reach tabs that were open before the extension loaded, `nativeMessaging` for the Atd shell,
 * `storage` for the pairing, the settings and HUD positions, and `sidePanel` for the panel. No
 * cookies, history, bookmarks, downloads or webRequest. `<all_urls>` lets the in-page HUD run on
 * any site; the content script reads nothing from a page until the person picks an element of it
 * for a request or sends one.
 *
 * The toolbar button has no popup here: by default it opens the in-page ask in the active tab, as
 * the ask command does, or the panel in Chrome's side panel on a tab no content script can run in;
 * the options page can make it open the side panel on every tab instead. Where a browser has no
 * side panel, the service worker sets the panel page as its popup
 * (`src/background/action-surface.ts`).
 *
 * The options page (`options_ui`, opened in a tab from the panel's More menu or Chrome's extension
 * details) holds the extension's own settings, its command shortcuts and the allowed websites;
 * crxjs builds the HTML it names.
 */
export function manifestFor(flavor: Flavor) {
  const identity = FLAVORS[flavor];
  return defineManifest({
    manifest_version: 3,
    name: `__MSG_${identity.nameMessage}__`,
    description: '__MSG_extDescription__',
    version: packageJson.version,
    default_locale: 'en',
    key: identity.key,
    minimum_chrome_version: '125',
    icons: {
      16: `icons/${flavor}/icon-16.png`,
      32: `icons/${flavor}/icon-32.png`,
      48: `icons/${flavor}/icon-48.png`,
      128: `icons/${flavor}/icon-128.png`,
    },
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: {
        16: `icons/${flavor}/toolbar-16.png`,
        32: `icons/${flavor}/toolbar-32.png`,
      },
    },
    side_panel: { default_path: 'src/panel/index.html' },
    options_ui: { page: 'src/options/index.html', open_in_tab: true },
    background: { service_worker: 'src/background/index.ts', type: 'module' },
    content_scripts: [
      { matches: ['<all_urls>'], js: ['src/content/index.ts'], run_at: 'document_idle' },
    ],
    commands: {
      'ask-on-page': {
        // Chrome rejects Alt with Ctrl or Command in a suggested key, so the default cannot be ⌥⌘K;
        // a person can still assign that at chrome://extensions/shortcuts.
        suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' },
        description: '__MSG_commandAsk__',
      },
    },
    permissions: [
      'debugger',
      'tabs',
      'tabGroups',
      'storage',
      'nativeMessaging',
      'scripting',
      'sidePanel',
    ],
    host_permissions: ['<all_urls>'],
    // Dev builds emit external `.map` files; webpage DevTools needs the content script's map
    // reachable at its static extension URL, while release keeps `web_accessible_resources` empty.
    ...(flavor === 'dev'
      ? {
          web_accessible_resources: [
            {
              resources: ['src/content/index.js.map'],
              matches: ['<all_urls>'],
              use_dynamic_url: false,
            },
          ],
        }
      : {}),
  });
}
