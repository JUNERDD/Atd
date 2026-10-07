/** Facts about the product the whole site links to or quotes. */
export const site = {
  name: 'Atd',
  author: 'JUNERDD',
  /** The latest published release; the download links always resolve the newest one on GitHub. */
  version: '0.7.0',
  repoUrl: 'https://github.com/JUNERDD/ai',
  releasesUrl: 'https://github.com/JUNERDD/ai/releases',
  latestReleaseUrl: 'https://github.com/JUNERDD/ai/releases/latest',
  issuesUrl: 'https://github.com/JUNERDD/ai/issues',
  minMacOS: '26',
  chip: 'Apple silicon',
  /** The default global shortcut that shows and hides the panel. */
  shortcut: ['⌘', '⇧', 'Space'],
} as const;
