import type { SettingsSearchEntry } from './settings-search-index';

/** General › Screenshot, in page order (`screenshot-settings.tsx` marks the anchors). */
export const screenshotSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'screenshot-save-location',
    section: 'general',
    anchor: 'settings-screenshot-save-location',
    label: 'screenshot.saveLocation.searchLabel',
    description: 'screenshot.saveLocation.description',
    keywords: 'search.keywords.screenshotSaveLocation',
  },
  {
    id: 'screenshot-copy-on-confirm',
    section: 'general',
    anchor: 'settings-screenshot-copy-on-confirm',
    label: 'screenshot.copyOnConfirm.title',
    description: 'screenshot.copyOnConfirm.description',
    keywords: 'search.keywords.screenshotCopyOnConfirm',
  },
  {
    id: 'long-screenshot-confirm-action',
    section: 'general',
    anchor: 'settings-long-screenshot-confirm-action',
    label: 'screenshot.longScreenshotConfirmAction.title',
    description: 'screenshot.longScreenshotConfirmAction.description',
    keywords: 'search.keywords.longScreenshotConfirmAction',
  },
];
