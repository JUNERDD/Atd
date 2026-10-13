import type { Localized } from '../i18n/routes';

/** One native installer: the Macs it runs on and the stable mirror URL of its newest verified release. */
export interface Download {
  arch: 'arm64' | 'x64';
  /** The chip family the build is for, as each language names it. */
  chip: Localized<string>;
  /** Saves as `Atd-<version>-<arch>.dmg`. */
  url: string;
  /** The oldest macOS major version the build runs on. */
  minMacOS: string;
}

/** Facts about the product the whole site links to or quotes. */
export const site = {
  name: 'Atd',
  author: 'JUNERDD',
  /** The version described by this site; the stable download follows verified releases. */
  version: '0.8.1',
  repoUrl: 'https://github.com/JUNERDD/Atd',
  releasesUrl: 'https://github.com/JUNERDD/Atd/releases',
  /** One installer per architecture, offered side by side; the visitor picks their Mac's chip. */
  downloads: [
    {
      arch: 'arm64',
      chip: { en: 'Apple silicon', zh: 'Apple 芯片' },
      url: 'https://downloads.atd.best/latest/Atd-arm64.dmg',
      minMacOS: '15',
    },
    {
      arch: 'x64',
      chip: { en: 'Intel', zh: 'Intel 处理器' },
      url: 'https://downloads.atd.best/latest/Atd-x64.dmg',
      minMacOS: '15',
    },
  ] as const satisfies readonly Download[],
  issuesUrl: 'https://github.com/JUNERDD/Atd/issues',
  /** The open-source license the repository is released under, and its text. */
  license: 'MIT',
  licenseUrl: 'https://github.com/JUNERDD/Atd/blob/main/LICENSE',
  /** The default global shortcut that shows and hides the panel. */
  shortcut: ['⌘', '⇧', 'Space'],
} as const;
