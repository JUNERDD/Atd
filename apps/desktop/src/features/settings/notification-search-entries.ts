import type { SettingsSearchEntry } from './settings-search-index';

/** General › Notifications, in page order (`notification-settings.tsx` marks the anchors). */
export const notificationSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'notifications-finished',
    section: 'general',
    anchor: 'settings-notifications-finished',
    label: 'notifications.finished.title',
    description: 'notifications.finished.description',
    keywords: 'search.keywords.notificationsFinished',
  },
  {
    id: 'notifications-attention',
    section: 'general',
    anchor: 'settings-notifications-attention',
    label: 'notifications.attention.title',
    description: 'notifications.attention.description',
    keywords: 'search.keywords.notificationsAttention',
  },
  {
    id: 'notifications-sound',
    section: 'general',
    anchor: 'settings-notifications-sound',
    label: 'notifications.sound.title',
    description: 'notifications.sound.description',
    keywords: 'search.keywords.notificationsSound',
  },
  {
    id: 'notifications-previews',
    section: 'general',
    anchor: 'settings-notifications-previews',
    label: 'notifications.previews.title',
    description: 'notifications.previews.description',
    keywords: 'search.keywords.notificationsPreviews',
  },
];
