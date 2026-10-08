/** Facts about the product the whole site links to or quotes. */
export const site = {
  name: 'Atd',
  author: 'JUNERDD',
  /** The version described by this site; the stable download follows verified releases. */
  version: '0.7.1',
  repoUrl: 'https://github.com/JUNERDD/ai',
  releasesUrl: 'https://github.com/JUNERDD/ai/releases',
  downloadUrl: 'https://downloads.atd.best/latest/Atd-arm64.dmg',
  issuesUrl: 'https://github.com/JUNERDD/ai/issues',
  minMacOS: '26',
  chip: 'Apple silicon',
  /** The default global shortcut that shows and hides the panel. */
  shortcut: ['⌘', '⇧', 'Space'],
} as const;
