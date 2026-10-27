import { site } from '../../content/site';
import type { Lang, Localized } from '../../i18n/lang';

interface DownloadCopy {
  title: string;
  lede: string;
  /** Names the pair of download keys for assistive technology. */
  choose: string;
  /** The label of the key that downloads the installer for one chip family. */
  key: (chip: string) => string;
  /** How to tell which chip a Mac has, in one line. */
  which: string;
  /** Readouts beside the board; one with an `href` links to what it names. */
  specs: { label: string; value: string; href?: string }[];
  /** What to expect the first time it opens, in one line. */
  firstLaunch: string;
  /** Optional setup for tasks that operate websites. */
  computerSetup: string;
  /** Leads the preview line, before each chip family's name linking to its preview download. */
  preview: string;
}

/**
 * The supported macOS range, read from the installers: one figure while every architecture shares
 * it, otherwise each chip family with its own.
 */
function requires(lang: Lang): string {
  const versions = new Set(site.downloads.map((download) => download.minMacOS));
  if (versions.size === 1) return `macOS ${site.downloads[0].minMacOS}+`;
  return site.downloads
    .map((download) => `${download.chip[lang]} macOS ${download.minMacOS}+`)
    .join(' · ');
}

function chips(lang: Lang): string {
  return site.downloads.map((download) => download.chip[lang]).join(' · ');
}

export const downloadCopy = {
  en: {
    title: 'Ready when you are.',
    lede: 'Download Atd, connect a model in Settings → Models, then press ⌘ ⇧ Space to start.',
    choose: 'Download for Mac',
    key: (chip) => `Download for ${chip}`,
    which:
      'Not sure which? Choose Apple menu › About This Mac: a Mac with Apple silicon lists a Chip, an Intel Mac a Processor.',
    specs: [
      { label: 'Requires', value: requires('en') },
      { label: 'Chip', value: chips('en') },
      { label: 'Latest', value: `v${site.version}` },
      { label: 'License', value: site.license, href: site.licenseUrl },
    ],
    firstLaunch:
      'Atd isn’t notarized, so the first time, choose Open Anyway in System Settings › Privacy & Security. It updates itself after that.',
    computerSetup:
      'For website tasks, open Settings → Computer use, install the browser engine, and sign in to the sites you need in its separate browser.',
    preview: 'Preview: ',
  },
  zh: {
    title: '随时待命。',
    lede: '下载 Atd，在「设置 → 模型」中连接模型，再按下 ⌘ ⇧ Space 开始。',
    choose: '下载 Mac 版',
    key: (chip) => `下载 ${chip}版`,
    which:
      '不确定选哪个？选取苹果菜单 › 关于本机：搭载 Apple 芯片的 Mac 显示“芯片”，Intel 机型显示“处理器”。',
    specs: [
      { label: '系统要求', value: requires('zh') },
      { label: '芯片', value: chips('zh') },
      { label: '最新版本', value: `v${site.version}` },
      { label: '开源许可', value: site.license, href: site.licenseUrl },
    ],
    firstLaunch:
      'Atd 未经公证，首次打开时请在“系统设置 › 隐私与安全性”中点按“仍要打开”。此后它会自行更新。',
    computerSetup:
      '需要操作网站时，在「设置 → 电脑操作」中安装浏览器引擎，再在独立的浏览器环境中登录所需网站。',
    preview: '预览版：',
  },
} satisfies Localized<DownloadCopy>;
