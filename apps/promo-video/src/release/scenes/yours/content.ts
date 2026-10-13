import type { Lang } from '../../../copy.ts';
import { releaseCopy } from '../../copy.ts';

/** The four vignettes, in film order, each named for the line it lands. */
export type Vignette = 'plan' | 'effort' | 'light' | 'order';

/** A command as the Commands list shows it (user data: the starter commands' names). */
export interface ListedCommand {
  name: string;
  description: string;
  /** Its shortcut's keycaps; empty when none is set. */
  keys: readonly string[];
}

interface YoursContent {
  /**
   * Where each statement breaks: its second line, which must end the narrative copy
   * (`releaseCopy[lang].yours`). The first line lands early; the second lands on the payoff.
   */
  secondLine: Record<Vignette, string>;
  /** The provider form for an OpenAI account (`providers.json` `form`, `login`). */
  provider: { name: string; signIn: string; connectionName: string; cancelSignIn: string };
  /** The command whose run settings change, and the run settings' other two fields (`commands.json` `run`). */
  editor: {
    command: string;
    model: string;
    useAppDefault: string;
    memory: string;
    memoryInherit: string;
  };
  /** The light run: a command chip and a rough draft, then the answer it gets. */
  light: { command: string; draft: string; answer: string };
  /** The Commands list, top to bottom, before the reorder. */
  commands: readonly ListedCommand[];
}

/**
 * What the yours section shows inside the product's interface, per language. Product copy is
 * verbatim from the renderer's locale files (`providers.json`, `commands.json`); the settings
 * window's own copy comes from the kit (`strings[lang].settings`). Command names and descriptions
 * are the starter commands' (`agent-service` `starters.ts`), which are user data, written in the
 * cut's language in Chinese. Registered with the fonts through `src/release/content.ts`.
 */
export const content = {
  en: {
    secondLine: {
      plan: 'plan.',
      effort: 'per command.',
      light: 'land fast.',
      order: 'everywhere.',
    },
    provider: {
      name: 'OpenAI',
      signIn: 'Sign in to OpenAI',
      connectionName: 'Connection name',
      cancelSignIn: 'Cancel sign-in',
    },
    editor: {
      command: 'Review code',
      model: 'Model',
      useAppDefault: 'Use app default',
      memory: 'Memory',
      memoryInherit: 'Use memory · Follow global learning setting',
    },
    light: {
      command: 'Polish writing',
      draft: 'thx, see u thurs at 10',
      answer: 'Thanks, see you Thursday at 10.',
    },
    commands: [
      {
        name: 'Polish writing',
        description: 'Make the selected writing clear and natural.',
        keys: ['⌥', 'P'],
      },
      { name: 'Summarize', description: 'Condense the selected text to what matters.', keys: [] },
      {
        name: 'Explain',
        description: 'Explain the selected text or code in plain language.',
        keys: [],
      },
      {
        name: 'Translate',
        description: 'Translate the selected text and keep its formatting.',
        keys: ['⌥', 'T'],
      },
      {
        name: 'Extract action items',
        description: 'Turn notes into a list of next steps.',
        keys: [],
      },
    ],
  },
  zh: {
    secondLine: {
      plan: 'ChatGPT 套餐。',
      effort: '各自的推理力度。',
      light: '转瞬即达。',
      order: '处处一致。',
    },
    provider: {
      name: 'OpenAI',
      signIn: '登录 OpenAI',
      connectionName: '连接名称',
      cancelSignIn: '取消登录',
    },
    editor: {
      command: '审查代码',
      model: '模型',
      useAppDefault: '使用应用默认值',
      memory: '记忆',
      memoryInherit: '使用记忆 · 跟随全局学习设置',
    },
    light: {
      command: '润色文字',
      draft: '谢啦 周四十点见哈',
      answer: '谢谢，我们周四十点见。',
    },
    commands: [
      { name: '润色文字', description: '让选中的文字清晰自然。', keys: ['⌥', 'P'] },
      { name: '总结', description: '把选中的文字浓缩成要点。', keys: [] },
      { name: '解释', description: '用浅显的语言解释选中的文字或代码。', keys: [] },
      { name: '翻译', description: '翻译选中的文字，并保留原有格式。', keys: ['⌥', 'T'] },
      { name: '提取待办事项', description: '把笔记整理成下一步的清单。', keys: [] },
    ],
  },
} as const satisfies Record<Lang, YoursContent>;

/**
 * A statement's two lines: the narrative copy split before its second line. Throws if the copy
 * no longer ends with it, so an edit to either is caught at the first render.
 */
export function statementLines(lang: Lang, vignette: Vignette): readonly [string, string] {
  const text = releaseCopy[lang].yours[vignette];
  const second: string = content[lang].secondLine[vignette];
  if (!text.endsWith(second)) {
    throw new Error(`yours: "${text}" does not end with "${second}"`);
  }
  return [text.slice(0, text.length - second.length).trimEnd(), second];
}
