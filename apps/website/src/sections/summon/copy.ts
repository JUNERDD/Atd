import type { Localized } from '../../i18n/lang';

interface SummonCopy {
  kicker: string;
  title: string;
  lede: string;
  /** The shortcut spelled out for assistive tech; the keycaps themselves are decorative. */
  shortcutName: string;
  tryIt: string;
  hint: string;
  /** Spoken after the visitor toggles the demo. */
  announce: { shown: string; hidden: string; back: string };
  /** The state readout drawn inside the display, in mono: no key symbols (SF Mono has no ⇧). */
  state: { idle: string; shown: string; hidden: string };
  diagramLabel: string;
  draft: string;
  draftKept: string;
  readouts: { label: string; value: string }[];
}

export const summonCopy = {
  en: {
    kicker: 'Summon',
    title: 'Always one shortcut away.',
    lede: 'Press ⌘ ⇧ Space anywhere and Atd rises in the corner of your screen. Press it again to put it away; your draft stays where you left it.',
    shortcutName: 'Shortcut: Command Shift Space',
    tryIt: 'Try it',
    hint: 'Or press ⌘ ⇧ Space on this page.',
    announce: {
      shown: 'The panel is showing in the bottom-right corner.',
      hidden: 'The panel is hidden. Your draft is kept.',
      back: 'The panel is back, and so is your draft.',
    },
    state: {
      idle: 'Standby',
      shown: 'Shown',
      hidden: 'Hidden · draft kept',
    },
    diagramLabel:
      'Diagram: a 1512 by 982 point display with the Atd panel, 420 by 580 points, 16 points from the bottom-right corner.',
    draft: 'Sort the screenshots on my Desktop by date',
    draftKept: 'Draft kept',
    readouts: [
      { label: 'Panel', value: '420 × 580 pt' },
      { label: 'Edge offset', value: '16 pt, bottom right' },
      { label: 'Displays', value: 'Main or secondary' },
      { label: 'Stay on top', value: 'Your choice' },
      { label: 'Menu bar', value: 'Icon included' },
    ],
  },
  zh: {
    kicker: '唤出',
    title: '一个快捷键，随叫随到。',
    lede: '在任何地方按下 ⌘ ⇧ Space，Atd 就会出现在屏幕一角。再按一次即可收起，草稿原样保留。',
    shortcutName: '快捷键：Command Shift 空格',
    tryIt: '试一试',
    hint: '也可以直接在本页按下 ⌘ ⇧ Space。',
    announce: {
      shown: '面板已显示在屏幕右下角。',
      hidden: '面板已收起，草稿已保留。',
      back: '面板回来了，草稿还在。',
    },
    state: {
      idle: '待命',
      shown: '已显示',
      hidden: '已收起 · 草稿保留',
    },
    diagramLabel:
      '示意图：一块 1512 × 982 pt 的显示器，420 × 580 pt 的 Atd 面板位于右下角，距边缘 16 pt。',
    draft: '把桌面上的截图按日期整理好',
    draftKept: '草稿已保留',
    readouts: [
      { label: '面板', value: '420 × 580 pt' },
      { label: '边距', value: '16 pt，右下角' },
      { label: '显示器', value: '主屏或副屏均可' },
      { label: '置顶', value: '可开可关' },
      { label: '菜单栏', value: '图标常驻' },
    ],
  },
} satisfies Localized<SummonCopy>;
