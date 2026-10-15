import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface DownloadCopy {
  title: string;
  lede: string;
  cta: string;
  /** Readouts beside the board; one with an `href` links to what it names. */
  specs: { label: string; value: string; href?: string }[];
  /** What to expect the first time it opens, in one line. */
  firstLaunch: string;
  /** The label of the key that downloads one chip family's preview build. */
  previewKey: (chip: string) => string;
  /** What the preview keys offer and where the builds run, in one line. */
  previewNote: string;
}

export const downloadCopy = {
  en: {
    title: 'Ready when you are.',
    lede: 'Download Atd, press ⌘ ⇧ Space, and hand it your first task.',
    cta: 'Download for Mac',
    specs: [
      { label: 'Requires', value: `macOS ${site.minMacOS}+` },
      { label: 'Chip', value: site.chip },
      { label: 'Latest', value: `v${site.version}` },
      { label: 'License', value: site.license, href: site.licenseUrl },
    ],
    firstLaunch:
      'Atd isn’t notarized, so the first time, choose Open Anyway in System Settings › Privacy & Security. It updates itself after that.',
    previewKey: (chip) => `Preview for ${chip}`,
    previewNote: `Preview builds are release candidates of the next version, for macOS ${site.preview.minMacOS}+ on Apple silicon or Intel.`,
  },
  zh: {
    title: '随时待命。',
    lede: '下载 Atd，按下 ⌘ ⇧ Space，交给它第一个任务。',
    cta: '下载 Mac 版',
    specs: [
      { label: '系统要求', value: `macOS ${site.minMacOS}+` },
      { label: '芯片', value: 'Apple 芯片' },
      { label: '最新版本', value: `v${site.version}` },
      { label: '开源许可', value: site.license, href: site.licenseUrl },
    ],
    firstLaunch:
      'Atd 未经公证，首次打开时请在“系统设置 › 隐私与安全性”中点按“仍要打开”。此后它会自行更新。',
    previewKey: (chip) => `预览版 · ${chip}`,
    previewNote: `预览版是下一个版本的候选版本，支持 macOS ${site.preview.minMacOS}+ 的 Apple 芯片和 Intel 机型。`,
  },
} satisfies Localized<DownloadCopy>;
