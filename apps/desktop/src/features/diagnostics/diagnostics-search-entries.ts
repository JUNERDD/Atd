import type { SettingsSearchEntry } from '../settings/settings-search-index';

export const diagnosticsSearchEntries: readonly SettingsSearchEntry[] = [
  {
    id: 'diagnostics-doctor',
    section: 'diagnostics',
    anchor: 'diagnostics-doctor',
    label: 'diagnostics:search.doctorLabel',
    description: 'diagnostics:search.doctorDescription',
    keywords: 'diagnostics:search.doctorKeywords',
  },
  {
    id: 'diagnostics-live-probes',
    section: 'diagnostics',
    anchor: 'diagnostics-live-probes',
    label: 'diagnostics:search.liveProbesLabel',
    description: 'diagnostics:search.liveProbesDescription',
    keywords: 'diagnostics:search.liveProbesKeywords',
  },
  {
    id: 'diagnostics-export',
    section: 'diagnostics',
    anchor: 'diagnostics-export',
    label: 'diagnostics:search.exportLabel',
    description: 'diagnostics:search.exportDescription',
    keywords: 'diagnostics:search.exportKeywords',
  },
];
