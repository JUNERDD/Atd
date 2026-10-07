import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface DownloadCopy {
  title: string;
  lede: string;
  cta: string;
  specs: { label: string; value: string }[];
  /** What to expect the first time it opens, in one line. */
  firstLaunch: string;
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
    ],
    firstLaunch:
      'Atd isn’t notarized, so the first time, choose Open Anyway in System Settings › Privacy & Security. It updates itself after that.',
  },
  zh: {
    title: '随时待命。',
    lede: '下载 Atd，按下 ⌘ ⇧ Space，交给它第一个任务。',
    cta: '下载 Mac 版',
    specs: [
      { label: '系统要求', value: `macOS ${site.minMacOS}+` },
      { label: '芯片', value: 'Apple 芯片' },
      { label: '最新版本', value: `v${site.version}` },
    ],
    firstLaunch:
      'Atd 未经公证，首次打开时请在“系统设置 › 隐私与安全性”中点按“仍要打开”。此后它会自行更新。',
  },
} satisfies Localized<DownloadCopy>;
