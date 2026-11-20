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
    id: 'screenshot-confirm-action',
    section: 'general',
    anchor: 'settings-screenshot-confirm-action',
    label: 'screenshot.confirmAction.title',
    description: 'screenshot.confirmAction.description',
    keywords: 'search.keywords.screenshotConfirmAction',
  },
  {
    id: 'screenshot-confirm-in-composer',
    section: 'general',
    anchor: 'settings-screenshot-confirm-in-composer',
    label: 'screenshot.confirmInComposer.title',
    description: 'screenshot.confirmInComposer.description',
    keywords: 'search.keywords.screenshotConfirmInComposer',
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
