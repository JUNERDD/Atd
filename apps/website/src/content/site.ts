import type { Localized } from '../i18n/routes';

/** One native installer: the Macs it runs on and the stable mirror URL of its newest verified release. */
export interface Download {
  arch: 'arm64' | 'x64';
  /** The chip family the build is for, as each language names it. */
  chip: Localized<string>;
  /** Saves as `Atd-<version>-<arch>.dmg`. */
  url: string;
  /**
   * The newest published release, a release candidate or the stable release once it catches up;
   * saves the same way. Offered only while it is newer than `site.version`.
   */
  previewUrl: string;
  /** The oldest macOS major version the build runs on. */
  minMacOS: string;
}

/** Facts about the product the whole site links to or quotes. */
export const site = {
  name: 'Atd',
  author: 'JUNERDD',
  /** The version described by this site; the stable download follows verified releases. */
  version: '0.9.0',
  repoUrl: 'https://github.com/JUNERDD/Atd',
  releasesUrl: 'https://github.com/JUNERDD/Atd/releases',
  /** One installer per architecture, offered side by side; the visitor picks their Mac's chip. */
  downloads: [
    {
      arch: 'arm64',
      chip: { en: 'Apple silicon', zh: 'Apple 芯片' },
      url: 'https://downloads.atd.best/latest/Atd-arm64.dmg',
      previewUrl: 'https://downloads.atd.best/rc/Atd-arm64.dmg',
      minMacOS: '15',
    },
    {
      arch: 'x64',
      chip: { en: 'Intel', zh: 'Intel 处理器' },
      url: 'https://downloads.atd.best/latest/Atd-x64.dmg',
      previewUrl: 'https://downloads.atd.best/rc/Atd-x64.dmg',
      minMacOS: '15',
    },
  ] as const satisfies readonly Download[],
  /**
   * The rc channel's manifest, which lists the preview version of each architecture. Served from the
   * site's own origin (a rewrite in `vercel.json`, a proxy in `vite.config.ts`) because the download
   * host sends no CORS headers.
   */
  previewManifestUrl: '/downloads/rc.json',
  issuesUrl: 'https://github.com/JUNERDD/Atd/issues',
  /** The open-source license the repository is released under, and its text. */
  license: 'MIT',
  licenseUrl: 'https://github.com/JUNERDD/Atd/blob/main/LICENSE',
  /** The default global shortcut that shows and hides the panel. */
  shortcut: ['⌘', '⇧', 'Space'],
} as const;
