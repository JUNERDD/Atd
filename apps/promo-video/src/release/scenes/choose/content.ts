import type { Lang } from '../../../copy.ts';
import { releaseCopy } from '../../copy.ts';

/**
 * What the choose section shows, per language: the kinetic words (from the film's narrative copy,
 * so they cannot drift), the note the commands run in, and the commands themselves. Command names,
 * the option's label and its values are the user's own commands' content (the starters' in
 * English, as a Chinese user would name them in Chinese), matching the product kit's review
 * stand-ins; the interface chrome around them (hold hint, When done, keys) comes from the kit's
 * verbatim `strings.ts`. Registered with the fonts through `src/release/content.ts`.
 */
export interface ChooseContent {
  words: { tap: string; hold: string; where: string };
  /** The note's window title and its heading line. */
  noteTitle: string;
  heading: string;
  /** Line 1 as typed, as the tap polishes it, and as the hold translates it into Japanese. */
  rough: string;
  polished: string;
  japanese: string;
  /** Line 2, and the translation the last run inserts after it. */
  doors: string;
  doorsJapanese: string;
  /** The two commands, on ⌥P and ⌥T as the kit's command rows have them. */
  polish: string;
  translate: string;
  /** Translate's one option and its values; the remembered value is the first, English. */
  languageLabel: string;
  languages: readonly string[];
}

export const content = {
  en: {
    words: releaseCopy.en.choose,
    noteTitle: 'Launch notes',
    heading: 'Friday launch',
    rough: 'thx for coming!! see u at the launch fri',
    polished: 'Thanks for coming! See you at the launch on Friday.',
    japanese: 'ご来場ありがとうございます！金曜日のローンチでお会いしましょう。',
    doors: 'Doors open at 6 pm.',
    doorsJapanese: ' 開場は午後6時です。',
    polish: 'Polish writing',
    translate: 'Translate',
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
  },
  zh: {
    words: releaseCopy.zh.choose,
    noteTitle: '发布会笔记',
    heading: '周五发布会',
    rough: '谢谢大家来哈 周五发布会见',
    polished: '感谢各位到场，我们周五发布会见！',
    japanese: 'ご来場ありがとうございます！金曜日の発表会でお会いしましょう。',
    doors: '晚上六点开始入场。',
    doorsJapanese: '開場は午後6時です。',
    polish: '润色文字',
    translate: '翻译',
    languageLabel: '目标语言',
    languages: ['英语', '简体中文', '繁体中文', '日语', '韩语', '法语', '德语', '西班牙语'],
  },
} as const satisfies Record<Lang, ChooseContent>;

/** The remembered target language (the starter's default) and the one the hold picks (key 4). */
export const REMEMBERED_LANGUAGE = 0;
export const PICKED_LANGUAGE = 3;
