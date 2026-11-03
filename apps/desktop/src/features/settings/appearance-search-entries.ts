import type { SettingsSearchEntry } from './settings-search-index';

/**
 * The rows of General › Panel background (`panel-background-rows.tsx` and
 * `panel-background-glass.tsx`), in page order; each opens the sub-page at its row. The Liquid
 * Glass rows show only on macOS 26; elsewhere their entries open the page at its top.
 */
const panelBackgroundEntries = (
  [
    ['transparency', 'panelTransparency'],
    ['tone', 'panelTone'],
    ['tint', 'panelTint'],
    ['variant', 'liquidGlass'],
    ['blur', 'panelBlur'],
    ['refractionWidth', 'panelRefraction'],
    ['refractionStrength', 'panelRefraction'],
  ] as const
).map(([row, keywords]): SettingsSearchEntry => ({
  id: `panel-background-${row}`,
  section: 'general',
  page: 'panelBackground',
  anchor: `panel-background-${row}`,
  label: `panelBackground.${row}.title`,
  description: `panelBackground.${row}.description`,
  keywords: `search.keywords.${keywords}`,
}));

/**
 * General › Appearance, in page order (`appearance-row.tsx`, `panel-background-summary-row.tsx`
 * and `glow-effects-row.tsx`), with the panel background's sub-page after its row.
 */
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
    id: 'appearance-panel-background',
    section: 'general',
    anchor: 'settings-panel-background',
    label: 'panelBackground.title',
    description: 'panelBackground.description',
    keywords: 'search.keywords.panelBackground',
  },
  ...panelBackgroundEntries,
  {
    id: 'appearance-glow-effects',
    section: 'general',
    anchor: 'settings-glow-effects',
    label: 'shortcuts.glowEffects.title',
    description: 'shortcuts.glowEffects.description',
    keywords: 'search.keywords.glowEffects',
  },
];
