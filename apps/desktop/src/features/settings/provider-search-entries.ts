import type { SettingsSearchEntry } from './settings-search-index';

/** Models & Providers entries (`provider-settings.tsx` and `model-aliases-section.tsx` mark anchors). */
export const providerSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'providers-default-model',
    section: 'providers',
    label: 'providers.overview.defaultModel',
    description: 'providers.overview.description',
    keywords: 'search.keywords.defaultModel',
  },
  {
    id: 'providers-model-aliases',
    section: 'providers',
    page: 'modelAliases',
    anchor: 'settings-providers-aliases',
    label: 'providers.overview.modelAliases',
    description: 'providers.overview.modelAliasesDescription',
    keywords: 'search.keywords.modelAliases',
  },
  {
    id: 'providers-connected',
    section: 'providers',
    label: 'providers.overview.connectedProviders',
    keywords: 'search.keywords.connectedProviders',
  },
  {
    id: 'providers-add',
    section: 'providers',
    label: 'providers.overview.addProvider',
    keywords: 'search.keywords.addProvider',
  },
];
