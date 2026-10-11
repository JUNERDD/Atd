import type { Lang } from '../../../copy.ts';

/**
 * The world sheet's demo lines, per language. The sheet shows both languages side by side; these
 * are review material, not the film's copy, but the fonts must cover them all the same.
 */
export const content = {
  en: {
    messy: 'hey can u send the deck by thurs, its kinda urgent',
    polished: 'Could you send the deck by Thursday? It’s time-sensitive.',
    note: 'Notes',
    noteLine: 'Draft: launch notes for Thursday',
    labels: {
      type: 'DotField · Caret · TypeLine',
      statement: 'Statement · CaretWipe',
      stage: 'Stage · SelectionFlood',
    },
  },
  zh: {
    messy: '那个 deck 周四前能发我吗 有点急',
    polished: '能否在周四前把演示文稿发给我？此事比较紧急。',
    note: '备忘录',
    noteLine: '草稿：周四的发布说明',
    labels: {
      type: 'DotField · Caret · TypeLine',
      statement: 'Statement · CaretWipe',
      stage: 'Stage · SelectionFlood',
    },
  },
} as const satisfies Record<Lang, object>;
