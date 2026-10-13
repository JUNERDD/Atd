import type { Lang } from '../../../copy.ts';
import { fill, strings } from '../../../kit/product/strings.ts';
import { releaseCopy } from '../../copy.ts';

/**
 * What the writeback section shows, per language. The narrative words come from the film's copy,
 * the destination labels from the product kit's verbatim shell strings (`commandOptions.output.*`)
 * and the answer card's note from its verbatim `commandOutput.unwritten.failed`, so none can drift;
 * everything else is content inside the interface (a note, its rough paragraph and the polished
 * answer, the command names as the starter commands have them, and the montage's demos) plus the
 * fallback's narrative label. Registered with the fonts through `src/release/content.ts`.
 */

/** One destination demo: a window with an optional first line and one paragraph to act on. */
export interface DemoContent {
  /** The window's title. */
  title: string;
  /** A first line above the paragraph (a greeting, a heading); '' for none. */
  lead: string;
  /** The paragraph's text before the target, the target (selected, or empty at a caret), after. */
  before: string;
  target: string;
  after: string;
  /** The answer the destination receives (the fallback's shows on the answer card instead). */
  answer: string;
}

/** The fallback demo: a read-only page whose answer cannot be written, so it waits on the card. */
export interface FallbackContent extends DemoContent {
  /** The app the page is in, which the card's note names. */
  app: string;
  /** The command that ran, the card's title. */
  command: string;
  /** Why it was not written, verbatim (`commandOutput.unwritten.failed`). */
  note: string;
}

export interface WritebackContent {
  /** The app the note is in, as the menu bar names it. */
  app: string;
  note: {
    title: string;
    meta: string;
    /** The rough paragraph, set line by line so the drag selection can follow the pointer. */
    rough: readonly string[];
    /** The same paragraph as Polish writing writes it back. */
    polished: string;
    /** A following paragraph that reflows under the answer. */
    next: string;
  };
  /** The toolbar's commands after Ask Atd, as the starter commands name them; `clicked` runs. */
  commands: readonly string[];
  clicked: number;
  words: { select: string; ask: string; back: string };
  montage: {
    /** The kicker over the destinations' labels: the options' own name for the choice. */
    kicker: string;
    /** The three destinations verbatim, then the fallback's narrative line (no kicker over it). */
    labels: {
      replaceSelection: string;
      insertAfterSelection: string;
      insertAtCursor: string;
      unwritten: string;
    };
    demos: {
      replaceSelection: DemoContent;
      insertAfterSelection: DemoContent;
      insertAtCursor: DemoContent;
      unwritten: FallbackContent;
    };
  };
}

function labels(lang: Lang, unwritten: string): WritebackContent['montage']['labels'] {
  const output = strings[lang].command.output;
  return {
    replaceSelection: output.replaceSelection,
    insertAfterSelection: output.insertAfterSelection,
    insertAtCursor: output.insertAtCursor,
    unwritten,
  };
}

/** The card's note for `app`, as the page words it. */
const unwrittenNote = (lang: Lang, app: string) =>
  fill(strings[lang].command.unwritten.failed, { app });

export const content = {
  en: {
    app: 'Notes',
    note: {
      title: 'Launch update',
      meta: 'Today at 9:41',
      rough: [
        'so basically launch got pushed to next week bc',
        'the build wasnt ready. we think itll be fine',
        'but cant really promise anything yet',
      ],
      polished:
        "The launch moved to next week because the build wasn't ready. We think it will go well, but can't promise yet.",
      next: 'Next: QA sign-off on Wednesday.',
    },
    commands: ['Translate', 'Polish writing'],
    clicked: 1,
    words: releaseCopy.en.writeback,
    montage: {
      kicker: strings.en.command.output.label,
      labels: labels('en', "Can't write there? The answer waits for you."),
      demos: {
        replaceSelection: {
          title: 'Re: Design review',
          lead: 'Hi Dana,',
          before: '',
          target: 'cant make the 3pm, can we do tmrw?',
          after: '',
          answer: "I can't make 3 p.m. Could we meet tomorrow?",
        },
        insertAfterSelection: {
          title: 'Trip notes',
          lead: 'Day 2 · Lisbon',
          before: '',
          target: 'The museum opens at nine.',
          after: '',
          answer: 'O museu abre às nove.',
        },
        insertAtCursor: {
          title: 'Re: Thursday',
          lead: 'Hi Sam,',
          before: '',
          target: '',
          after: '',
          answer: 'Thursday at 10 works for me. See you there!',
        },
        unwritten: {
          title: 'Museum hours',
          lead: 'Visit',
          before: '',
          target: 'The museum is closed on Mondays.',
          after: '',
          answer: 'Le musée est fermé le lundi.',
          app: 'Safari',
          command: 'Translate',
          note: unwrittenNote('en', 'Safari'),
        },
      },
    },
  },
  zh: {
    app: '备忘录',
    note: {
      title: '发布进展',
      meta: '今天 9:41',
      rough: ['就是发布推迟到下周了 因为构建还没好', '我们觉得应该没啥问题 但现在也不好说'],
      polished: '发布已推迟到下周，因为构建尚未就绪。我们预计一切顺利，但目前还无法保证。',
      next: '下一步：周三完成测试验收。',
    },
    commands: ['翻译', '润色文字'],
    clicked: 1,
    words: releaseCopy.zh.writeback,
    montage: {
      kicker: strings.zh.command.output.label,
      labels: labels('zh', '写不进去？答案在这里等你。'),
      demos: {
        replaceSelection: {
          title: '回复：设计评审',
          lead: 'Dana 你好，',
          before: '',
          target: '三点去不了 明天行不',
          after: '',
          answer: '我三点去不了，改到明天可以吗？',
        },
        insertAfterSelection: {
          title: '旅行笔记',
          lead: '第二天 · 里斯本',
          before: '',
          target: '博物馆九点开门。',
          after: '',
          answer: 'The museum opens at nine.',
        },
        insertAtCursor: {
          title: '回复：周四',
          lead: 'Sam 你好，',
          before: '',
          target: '',
          after: '',
          answer: '周四上午十点可以，到时见！',
        },
        unwritten: {
          title: '开放时间',
          lead: '参观',
          before: '',
          target: '博物馆周一闭馆。',
          after: '',
          answer: 'The museum is closed on Mondays.',
          app: 'Safari',
          command: '翻译',
          note: unwrittenNote('zh', 'Safari'),
        },
      },
    },
  },
} as const satisfies Record<Lang, WritebackContent>;
