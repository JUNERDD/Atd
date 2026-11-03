import type { SettingsSearchEntry } from './settings-search-index';

/**
 * General › Selection toolbar, in page order (`selection-toolbar-settings.tsx` and its row
 * components mark the anchors). The HUD and position rows show only in some states; while hidden,
 * their entries open the section at its top.
 */
export const selectionToolbarSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'selection-toolbar',
    section: 'general',
    anchor: 'settings-selection-toolbar',
    label: 'selectionToolbar.enabled',
    description: 'selectionToolbar.enabledDescription',
    keywords: 'search.keywords.selectionToolbar',
  },
  {
    id: 'selection-toolbar-activation',
    section: 'general',
    anchor: 'settings-selection-toolbar-activation',
    label: 'selectionToolbar.activation.title',
    description: 'selectionToolbar.activation.description',
    keywords: 'search.keywords.selectionToolbarActivation',
  },
  {
    id: 'selection-toolbar-hud',
    section: 'general',
    anchor: 'settings-selection-toolbar-hud',
    label: 'selectionToolbar.hud.title',
    description: 'selectionToolbar.hud.description',
    keywords: 'search.keywords.selectionToolbarHud',
  },
  {
    id: 'selection-toolbar-small-icon',
    section: 'general',
    anchor: 'settings-selection-toolbar-small-icon',
    label: 'selectionToolbar.smallIcon.title',
    keywords: 'search.keywords.selectionToolbarSmallIcon',
  },
  {
    id: 'selection-toolbar-position',
    section: 'general',
    anchor: 'settings-selection-toolbar-position',
    label: 'selectionToolbar.position.title',
    keywords: 'search.keywords.selectionToolbarPosition',
  },
  {
    id: 'selection-toolbar-apps',
    section: 'general',
    anchor: 'settings-selection-toolbar-apps',
    label: 'selectionToolbar.excluded.title',
    description: 'selectionToolbar.excluded.description',
    keywords: 'search.keywords.selectionToolbarApps',
  },
];
