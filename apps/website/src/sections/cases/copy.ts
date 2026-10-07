import type { Localized } from '../../i18n/lang';

interface CasesCopy {
  label: string;
  title: string;
  lede: string;
  views: string;
  carousel: string;
  slide: string;
  note: string;
  openImage: string;
  imageUnavailable: string;
  previous: string;
  next: string;
  play: string;
  pause: string;
  interval: (seconds: number) => string;
  duration: (seconds: number) => string;
}

export const casesCopy = {
  en: {
    label: 'Interfaces',
    title: 'At hand, in every detail.',
    lede: 'From a quick selection to an app of your own. Eight ways to work with Atd.',
    views: 'Explore Atd interfaces',
    carousel: 'carousel',
    slide: 'slide',
    note: 'Interface previews',
    openImage: 'View original image',
    imageUnavailable: 'This image could not be loaded. Open the original to try again.',
    previous: 'Previous case',
    next: 'Next case',
    play: 'Start slideshow',
    pause: 'Pause slideshow',
    interval: (seconds) => `Advance every ${seconds} seconds`,
    duration: (seconds) => `${seconds}s`,
  },
  zh: {
    label: '界面',
    title: '每一步，都顺手。',
    lede: '从一次选区，到一个自己的应用。看看 Atd 的八个工作界面。',
    views: '浏览 Atd 界面',
    carousel: '轮播',
    slide: '幻灯片',
    note: '界面预览',
    openImage: '查看原图',
    imageUnavailable: '图片暂时无法加载，可以打开原图重试。',
    previous: '上一个案例',
    next: '下一个案例',
    play: '开始轮播',
    pause: '暂停轮播',
    interval: (seconds) => `每 ${seconds} 秒自动切换`,
    duration: (seconds) => `${seconds}秒`,
  },
} satisfies Localized<CasesCopy>;
