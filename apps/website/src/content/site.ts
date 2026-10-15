import type { Localized } from '../i18n/routes';

/** One preview installer: the chip family it is built for and its mirror URL. */
export interface PreviewDownload {
  /** The chip family the build is for, as each language names it. */
  chip: Localized<string>;
  /** Saves as `Atd-<version>-<arch>.dmg`. */
  url: string;
}

/** Facts about the product the whole site links to or quotes. */
export const site = {
  name: 'Atd',
  author: 'JUNERDD',
  /** The version described by this site; the stable download follows verified releases. */
  version: '0.8.1',
  repoUrl: 'https://github.com/JUNERDD/Atd',
  releasesUrl: 'https://github.com/JUNERDD/Atd/releases',
  downloadUrl: 'https://downloads.atd.best/latest/Atd-arm64.dmg',
  issuesUrl: 'https://github.com/JUNERDD/Atd/issues',
  /** The open-source license the repository is released under, and its text. */
  license: 'MIT',
  licenseUrl: 'https://github.com/JUNERDD/Atd/blob/main/LICENSE',
  minMacOS: '26',
  chip: 'Apple silicon',
  /**
   * The newest published release, a release candidate or the stable release once it catches up.
   * It can reach older systems and more chips than the stable download, so it names its own range.
   */
  preview: {
    minMacOS: '15',
    downloads: [
      {
        chip: { en: 'Apple silicon', zh: 'Apple 芯片' },
        url: 'https://downloads.atd.best/rc/Atd-arm64.dmg',
      },
      {
        chip: { en: 'Intel', zh: 'Intel 处理器' },
        url: 'https://downloads.atd.best/rc/Atd-x64.dmg',
      },
    ] as const satisfies readonly PreviewDownload[],
  },
  /** The default global shortcut that shows and hides the panel. */
  shortcut: ['⌘', '⇧', 'Space'],
} as const;
