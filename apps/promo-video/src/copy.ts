/**
 * The film's narrative voice, per language: the tagline, the chapter words and their sublines, the
 * one caption each moment carries, and the call to action. What appears inside the product's own
 * interface (articles, prompts, answers, app names) is each scene's `content.ts`, registered below
 * so the fonts load every glyph the film shows.
 */
import { content as anything } from './scenes/anything/content.ts';
import { content as anytime } from './scenes/anytime/content.ts';
import { content as anywhere } from './scenes/anywhere/content.ts';
import { content as finale } from './scenes/finale/content.ts';
import { content as open } from './scenes/open/content.ts';
import { content as yours } from './scenes/yours/content.ts';
import { strings as product } from './kit/product/strings.ts';
import { MAC_CHROME as mac } from './kit/world/chrome.ts';

export const LANGS = ['en', 'zh'] as const;
export type Lang = (typeof LANGS)[number];

/** The `lang` attribute for a cut, which also lets the stylesheets set Chinese differently. */
export function htmlLang(lang: Lang): string {
  return lang === 'zh' ? 'zh-CN' : 'en';
}

interface Chapter {
  /** The chapter's word, in English in both cuts: the three words spell out the name. */
  word: string;
  subline: string;
}

interface FilmCopy {
  tagline: string;
  anywhere: {
    chapter: Chapter;
    selection: string;
    screenshot: string;
    mini: string;
    summon: string;
  };
  anything: { chapter: Chapter; work: string; app: string; tools: string };
  anytime: { chapter: Chapter; timelapse: string; memory: string };
  yours: { models: string; promise: string };
  finale: { line: string; cta: string; url: string; specs: string };
}

export const copy: Record<Lang, FilmCopy> = {
  en: {
    tagline: 'The agent at hand on your Mac.',
    anywhere: {
      chapter: { word: 'Anywhere.', subline: 'In every app you use.' },
      selection: 'Select text in any app. Ask, translate, summarize.',
      screenshot: 'Point at anything on screen, then mark it up.',
      mini: 'Drop files in from the edge of your screen.',
      summon: 'One shortcut, and Atd is there.',
    },
    anything: {
      chapter: { word: 'Anything.', subline: 'Any task, start to finish.' },
      work: 'It plans, works in parallel, and asks before it acts.',
      app: 'Describe an app. Atd builds it.',
      tools: 'Need a command, a skill, an automation? Just ask.',
    },
    anytime: {
      chapter: { word: 'Anytime.', subline: 'Even while you’re away.' },
      timelapse: 'Tasks start on a schedule, when files arrive, or while your Mac rests.',
      memory: 'Correct it once. It remembers, and you review what it keeps.',
    },
    yours: {
      models: 'Any model. In the cloud, or right on your Mac.',
      promise: 'No account. No Atd server. Just yours.',
    },
    finale: {
      line: 'Your next task starts with a shortcut.',
      cta: 'Download for Mac',
      url: 'atd.best',
      specs: 'macOS 26+ · Apple silicon · Free and open source',
    },
  },
  zh: {
    tagline: '触手可及的 Mac 智能体。',
    anywhere: {
      chapter: { word: 'Anywhere.', subline: '在你用的每一个应用里。' },
      selection: '在任何应用中选中文字，提问、翻译、总结。',
      screenshot: '指向屏幕上的任何内容，再加上标注。',
      mini: '从屏幕边缘，把文件拖进来。',
      summon: '一个快捷键，Atd 随即就位。',
    },
    anything: {
      chapter: { word: 'Anything.', subline: '任何任务，从头做到尾。' },
      work: '先列计划，并行推进，动手之前先问你。',
      app: '描述一个应用，Atd 把它做出来。',
      tools: '要命令、技能还是自动化？说一声就好。',
    },
    anytime: {
      chapter: { word: 'Anytime.', subline: '你不在时，也在做事。' },
      timelapse: '按计划、文件到达或 Mac 空闲时，任务自己开始。',
      memory: '纠正一次，它就记住；记住什么，由你审核。',
    },
    yours: {
      models: '任意模型，云端或本机。',
      promise: '无需账号，不经 Atd 服务器，只属于你。',
    },
    finale: {
      line: '下一个任务，从一个快捷键开始。',
      cta: '下载 Mac 版',
      url: 'atd.best',
      specs: 'macOS 26+ · Apple 芯片 · 免费开源',
    },
  },
};

/** Each scene's in-interface content, which the fonts must cover as well. */
const CONTENT = [mac, product, open, anywhere, anything, anytime, yours, finale] as const;

/** Every string a language shows, so its font subsets can load before the first frame. */
export function allText(lang: Lang): string {
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(copy[lang]);
  for (const scene of CONTENT) collect(scene[lang]);
  return strings.join('');
}
