import type { Localized } from '../../i18n/lang';

interface CasesCopy {
  title: string;
  lede: string;
  /** Names the numbered case steps, each of which goes straight to its clip. */
  index: string;
  clipUnavailable: string;
  openClip: string;
}

export const casesCopy = {
  en: {
    title: 'At hand, in every detail.',
    lede: 'From a quick selection to an app of your own. Ten ways to work with Atd.',
    index: 'Atd interfaces',
    clipUnavailable: 'This clip could not be loaded.',
    openClip: 'Open the video',
  },
  zh: {
    title: '每一步，都顺手。',
    lede: '从一次选区，到一个自己的应用。看看 Atd 的十个工作界面。',
    index: 'Atd 界面',
    clipUnavailable: '视频暂时无法加载。',
    openClip: '打开视频',
  },
} satisfies Localized<CasesCopy>;
