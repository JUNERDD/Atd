import type { Localized } from '../../i18n/lang';

interface SummonCopy {
  /** The plate's printed name, as the nav calls the section. */
  label: string;
  title: string;
  lede: string;
  /** The legend printed over the keycaps. */
  legend: string;
  /** The shortcut spelled out for assistive tech; the keycaps themselves are decorative. */
  shortcutName: string;
  tryIt: string;
  hint: string;
  /** Spoken after the visitor toggles the demo. */
  announce: { shown: string; hidden: string; back: string };
  diagramLabel: string;
  unavailable: string;
}

export const summonCopy = {
  en: {
    label: 'Summon',
    title: 'Always one shortcut away.',
    lede: 'Atd rises in the corner of any screen. Press again to hide it; your draft stays.',
    legend: 'Shortcut',
    shortcutName: 'Shortcut: Command Shift Space',
    tryIt: 'Try it',
    hint: 'Or press ⌘ ⇧ Space on this page.',
    announce: {
      shown: 'The panel is showing in the bottom-right corner.',
      hidden: 'The panel is hidden. Your draft is kept.',
      back: 'The panel is back, and so is your draft.',
    },
    diagramLabel:
      'A real Atd window with an unsent draft. Show and hide it with the shortcut or button.',
    unavailable: 'The app preview could not be loaded.',
  },
  zh: {
    label: '唤出',
    title: '一个快捷键，随叫随到。',
    lede: 'Atd 从屏幕一角升起。再按一次收起，草稿原样保留。',
    legend: '快捷键',
    shortcutName: '快捷键：Command Shift 空格',
    tryIt: '试一试',
    hint: '也可以直接在本页按下 ⌘ ⇧ Space。',
    announce: {
      shown: '面板已显示在屏幕右下角。',
      hidden: '面板已收起，草稿已保留。',
      back: '面板回来了，草稿还在。',
    },
    diagramLabel: '真实 Atd 窗口，带有尚未发送的草稿。可以用快捷键或按钮唤出和收起。',
    unavailable: '应用画面暂时无法加载。',
  },
} satisfies Localized<SummonCopy>;
