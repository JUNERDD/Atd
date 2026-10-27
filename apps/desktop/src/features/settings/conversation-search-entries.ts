import type { SettingsSearchEntry } from './settings-search-index';

/**
 * Agent › Conversation, in page order (`conversation-settings.tsx` marks the anchors). The view
 * preference shows a sentence per selected level, so its entry searches the setting's description.
 */
export const conversationSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'conversation-summary-titles',
    section: 'agent',
    anchor: 'settings-summary-titles',
    label: 'shortcuts.summaryTitles.title',
    description: 'shortcuts.summaryTitles.description',
    keywords: 'search.keywords.summaryTitles',
  },
  {
    id: 'conversation-view-initiative',
    section: 'agent',
    anchor: 'settings-view-initiative',
    label: 'shortcuts.viewInitiative.title',
    description: 'shortcuts.viewInitiative.description',
    keywords: 'search.keywords.viewInitiative',
  },
];
