import type { SettingsSearchEntry } from './settings-search-index';

/** General › Appearance, in page order (`appearance-row.tsx` and `glow-effects-row.tsx`). */
export const appearanceSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'appearance-theme',
    section: 'general',
    anchor: 'settings-appearance',
    label: 'shortcuts.appearance.title',
    description: 'shortcuts.appearance.description',
    keywords: 'search.keywords.appearance',
  },
  {
    id: 'appearance-glow-effects',
    section: 'general',
    anchor: 'settings-glow-effects',
    label: 'shortcuts.glowEffects.title',
    description: 'shortcuts.glowEffects.description',
    keywords: 'search.keywords.glowEffects',
  },
];
