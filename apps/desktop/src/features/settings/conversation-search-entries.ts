import type { SettingsSearchEntry } from './settings-search-index';

/**
 * General › Conversation, in page order (`conversation-settings.tsx` marks the anchors). The row
 * shows a sentence per selected level, so the entry searches the setting's own description.
 */
export const conversationSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'conversation-view-initiative',
    section: 'general',
    anchor: 'settings-view-initiative',
    label: 'shortcuts.viewInitiative.title',
    description: 'shortcuts.viewInitiative.description',
    keywords: 'search.keywords.viewInitiative',
  },
];
