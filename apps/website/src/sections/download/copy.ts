import { site } from '../../content/site';
import type { Localized } from '../../i18n/lang';

interface DownloadCopy {
  kicker: string;
  title: string;
  lede: string;
  cta: string;
  releaseNotes: string;
  specs: { label: string; value: string }[];
  firstLaunchLabel: string;
  firstLaunch: string;
  updatesLabel: string;
  updates: string;
}

export const downloadCopy = {
  en: {
    kicker: 'Download',
    title: 'Ready when you are.',
    lede: 'Download Atd, press ⌘ ⇧ Space, and hand it your first task.',
    cta: 'Download for Mac',
    releaseNotes: 'Release notes',
    specs: [
      { label: 'Requires', value: `macOS ${site.minMacOS} or later` },
      { label: 'Chip', value: site.chip },
      { label: 'Latest', value: `v${site.version}` },
    ],
    firstLaunchLabel: 'First launch',
    firstLaunch:
      'Atd is ad hoc signed and not notarized, so macOS stops it the first time. Open System Settings › Privacy & Security and choose Open Anyway.',
    updatesLabel: 'Updates',
    updates: 'After that, installed copies update themselves.',
  },
  zh: {
    kicker: '下载',
    title: '随时待命。',
    lede: '下载 Atd，按下 ⌘ ⇧ Space，交给它第一个任务。',
    cta: '下载 Mac 版',
    releaseNotes: '更新说明',
    specs: [
      { label: '系统要求', value: `macOS ${site.minMacOS} 或更高版本` },
      { label: '芯片', value: 'Apple 芯片' },
      { label: '最新版本', value: `v${site.version}` },
    ],
    firstLaunchLabel: '首次打开',
    firstLaunch:
      'Atd 采用临时签名且未经公证，第一次打开时会被 macOS 拦下。请前往“系统设置 › 隐私与安全性”，点按“仍要打开”。',
    updatesLabel: '更新',
    updates: '此后，已安装的 Atd 会自行更新。',
  },
} satisfies Localized<DownloadCopy>;
