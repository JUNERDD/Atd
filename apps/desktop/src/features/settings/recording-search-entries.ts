import type { SettingsSearchEntry } from './settings-search-index';

/** General › Screen recording, in page order (`recording-settings.tsx` marks the anchors). */
export const recordingSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'recording-save-location',
    section: 'general',
    anchor: 'settings-recording-save-location',
    label: 'recording.saveLocation.searchLabel',
    description: 'recording.saveLocation.description',
    keywords: 'search.keywords.recordingSaveLocation',
  },
];
