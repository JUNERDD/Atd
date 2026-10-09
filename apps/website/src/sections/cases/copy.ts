import type { Localized } from '../../i18n/lang';

interface CasesCopy {
  title: string;
  lede: string;
  /** Names the progress bars, each of which goes straight to its scene. */
  index: string;
  imageUnavailable: string;
  openImage: string;
}

export const casesCopy = {
  en: {
    title: 'At hand, in every detail.',
    lede: 'From a quick selection to an app of your own. Eight ways to work with Atd.',
    index: 'Atd interfaces',
    imageUnavailable: 'This image could not be loaded.',
    openImage: 'Open the original',
  },
  zh: {
    title: '每一步，都顺手。',
    lede: '从一次选区，到一个自己的应用。看看 Atd 的八个工作界面。',
    index: 'Atd 界面',
    imageUnavailable: '图片暂时无法加载。',
    openImage: '打开原图',
  },
} satisfies Localized<CasesCopy>;
