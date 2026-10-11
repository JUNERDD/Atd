import type { Lang } from '../../copy.ts';

/**
 * Stand-in content for the review sheet's 0.8 pages (the island and options, and the settings
 * pieces) only: command names and values as the starter commands have them, an answer, an app.
 * Scenes bring their own from their `content.ts`; nothing here reaches the film.
 */
interface Sheet08Content {
  polish: string;
  translate: string;
  summarize: string;
  descriptions: { translate: string; polish: string; summarize: string };
  languageLabel: string;
  languages: string[];
  /** The remembered language's index. */
  language: number;
  app: string;
  answer: string;
  longAnswer: string;
}

export const sheet08: Record<Lang, Sheet08Content> = {
  en: {
    polish: 'Polish writing',
    translate: 'Translate',
    summarize: 'Summarize',
    descriptions: {
      translate: 'Translate the selected text and keep its formatting.',
      polish: 'Make the selected writing clear and natural.',
      summarize: 'Condense the selected text to what matters.',
    },
    languageLabel: 'Target language',
    languages: [
      'English',
      'Simplified Chinese',
      'Traditional Chinese',
      'Japanese',
      'Korean',
      'French',
      'German',
      'Spanish',
    ],
    language: 3,
    app: 'Safari',
    answer: 'Could you send the deck by Thursday? It’s time-sensitive.',
    longAnswer:
      'The night network now runs every twenty minutes between midnight and five, stopping at twenty-eight stations on three lines.\n\nNurses, bakers and cleaners who once spent an hour on two buses can be home in twenty minutes. The trains share tracks with daytime freight, and the stations stay open with a small crew rather than a full staff.\n\nEarly figures suggest eighteen thousand riders a night, well ahead of the forecast, and the transit authority plans to add a fourth line in the spring if the numbers hold through the winter.\n\nRiders can follow every train live in the transit app, and stations now post the next three departures on screens at each entrance. A night bus still meets the last train at each terminus, so nobody is left at a platform after the service ends for the night.\n\nThe city will review the first six months in June, looking at ridership, safety and cost per trip before it decides whether the night network becomes permanent.',
  },
  zh: {
    polish: '润色文字',
    translate: '翻译',
    summarize: '总结',
    descriptions: {
      translate: '翻译选中的文字，并保留原有格式。',
      polish: '让选中的文字清晰自然。',
      summarize: '把选中的文字浓缩成要点。',
    },
    languageLabel: '目标语言',
    languages: ['英语', '简体中文', '繁体中文', '日语', '韩语', '法语', '德语', '西班牙语'],
    language: 3,
    app: 'Safari',
    answer: '能否在周四前把演示文稿发给我？此事比较紧急。',
    longAnswer:
      '夜间线路现在午夜到五点每二十分钟一班，三条线路共停靠二十八个站。\n\n过去要换乘两趟公交、花一个小时回家的护士、面包师和保洁员，如今二十分钟就能到家。列车与白天的货运共用轨道，车站只留少量人员值守。\n\n初步数据显示每晚约有一万八千名乘客，远超预期；如果冬季客流保持稳定，交通部门计划在春季增开第四条线路。\n\n乘客可以在交通应用中实时查看每趟列车，各站入口的屏幕也会显示接下来三班列车的时间。',
  },
};
