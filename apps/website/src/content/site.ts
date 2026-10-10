/** Facts about the product the whole site links to or quotes. */
export const site = {
  name: 'Atd',
  author: 'JUNERDD',
  /** The version described by this site; the stable download follows verified releases. */
  version: '0.8.0',
  repoUrl: 'https://github.com/JUNERDD/Atd',
  releasesUrl: 'https://github.com/JUNERDD/Atd/releases',
  downloadUrl: 'https://downloads.atd.best/latest/Atd-arm64.dmg',
  issuesUrl: 'https://github.com/JUNERDD/Atd/issues',
  /** The open-source license the repository is released under, and its text. */
  license: 'MIT',
  licenseUrl: 'https://github.com/JUNERDD/Atd/blob/main/LICENSE',
  minMacOS: '26',
  chip: 'Apple silicon',
  /** The default global shortcut that shows and hides the panel. */
  shortcut: ['⌘', '⇧', 'Space'],
} as const;
