import type { Localized } from '../../i18n/lang';

interface CasesCopy {
  kicker: string;
  title: string;
  lede: string;
  /** The scroller's accessible name: it is a named region. */
  gallery: string;
  previous: string;
  next: string;
  /** Names the row of position dots; each dot is named by its recording's title. */
  pick: string;
  /** The play/pause toggle keeps one name; `aria-pressed` carries whether it is playing. */
  play: string;
  /** The test card a case shows until its recording is added. */
  recordingSoon: string;
  tags: string;
  comingIn: (version: string) => string;
}

export const casesCopy = {
  en: {
    kicker: 'In practice',
    title: 'Real tasks, start to finish.',
    lede: 'Short screen recordings of Atd at work on a Mac: the request, each step as it happens, and the result.',
    gallery: 'Recordings',
    previous: 'Previous recording',
    next: 'Next recording',
    pick: 'Choose a recording',
    play: 'Play',
    recordingSoon: 'Recording soon',
    tags: 'Tags',
    comingIn: (version) => `Coming in ${version}`,
  },
  zh: {
    kicker: '实录',
    title: '真实任务，从头到尾。',
    lede: '简短的录屏，记录 Atd 在 Mac 上处理真实任务的过程：提出请求，逐步执行，交付结果。',
    gallery: '录屏',
    previous: '上一段录屏',
    next: '下一段录屏',
    pick: '选择录屏',
    play: '播放',
    recordingSoon: '录屏即将上线',
    tags: '标签',
    comingIn: (version) => `${version} 即将推出`,
  },
} satisfies Localized<CasesCopy>;
