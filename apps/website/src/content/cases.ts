import type { Localized } from '../i18n/lang';

/*
 * The recordings in the "In practice" gallery (#cases), in page order.
 *
 * To show a recording: export `<id>.mp4` and its poster `<id>.jpg` into `public/cases/` (capture tips,
 * export settings and the ffmpeg commands are in `public/cases/README.md`), add `video` to the entry
 * with that `id`, and rewrite its `title`, `summary` and `tags` in both languages to match what the
 * recording shows. An entry without `video` shows a "Recording soon" test card instead.
 *
 * Entries can be added, removed and reordered freely; each `id` must be unique.
 */

/**
 * - `screen`: a 16:10 capture of the whole display, filling the card.
 * - `panel`: a portrait capture of just the 420 × 580 pt panel, centered on a dot-grid stage.
 */
export type CaseFrame = 'screen' | 'panel';

export interface CaseVideo {
  /** The H.264 MP4: a site path such as `/cases/<id>.mp4`, or an absolute URL (Vercel Blob, LFS). */
  src: string;
  /** The first frame as JPG or WebP at the video's size, shown until the video plays. */
  poster: string;
  /** The running time printed on the card, as `m:ss`. */
  duration: `${number}:${number}`;
  /** Optional smaller AV1 rendition in WebM. Browsers that can decode AV1 play it; the rest play `src`. */
  av1?: string;
}

export interface Case {
  /** Unique, and the file stem of the recording and its poster. */
  id: string;
  title: Localized<string>;
  /** One sentence. */
  summary: Localized<string>;
  /** Two or three short labels. */
  tags: readonly Localized<string>[];
  frame: CaseFrame;
  /** Set while the feature shown is unreleased: the card carries a "Coming in <version>" badge. */
  comingIn?: string;
  video?: CaseVideo;
}

export const cases: readonly Case[] = [
  {
    id: 'fix-failing-test',
    title: { en: 'Fix a failing test', zh: '修好一个失败的测试' },
    summary: {
      en: 'It reads the failure, edits the code and reruns the test, with every diff and terminal line inline.',
      zh: '它读取报错、修改代码、重新运行测试，每处差异和每行终端输出都直接显示在对话里。',
    },
    tags: [
      { en: 'Diffs', zh: '差异' },
      { en: 'Terminal', zh: '终端' },
    ],
    frame: 'screen',
  },
  {
    id: 'mention-and-command',
    title: { en: 'Mention files, run a saved command', zh: '提及文件，运行已存命令' },
    summary: {
      en: 'Type @ to bring in files and / to run a command you saved; both sit in the composer as chips.',
      zh: '输入 @ 提及文件，输入 / 运行保存好的命令，二者都以标签形式留在输入框里。',
    },
    tags: [
      { en: '@ Mentions', zh: '@ 提及' },
      { en: 'Commands', zh: '命令' },
    ],
    frame: 'panel',
  },
  {
    id: 'manual-approval',
    title: { en: 'Review each action first', zh: '每个操作，先过目' },
    summary: {
      en: 'With Manual approval, every file or terminal action waits for your OK before it runs.',
      zh: '选择“手动批准”时，每个文件或终端操作都会先等你确认，再执行。',
    },
    tags: [
      { en: 'Permissions', zh: '权限' },
      { en: 'Manual approval', zh: '手动批准' },
    ],
    frame: 'panel',
  },
  {
    id: 'ask-about-selection',
    title: { en: 'Ask about what you selected', zh: '就选中的内容提问' },
    summary: {
      en: 'Bring selected text or your clipboard into the composer as context, then ask about it.',
      zh: '把选中的文本或剪贴板内容作为上下文带进输入框，再直接提问。',
    },
    tags: [
      { en: 'Selected text', zh: '选中文本' },
      { en: 'Clipboard', zh: '剪贴板' },
    ],
    frame: 'screen',
  },
  {
    id: 'scheduled-automation',
    title: { en: 'Start work on a schedule', zh: '按计划自动开工' },
    summary: {
      en: 'A saved command runs by itself every morning, and the result arrives as a macOS notification.',
      zh: '保存好的命令每天早上自动运行，结果以 macOS 通知送达。',
    },
    tags: [
      { en: 'Automations', zh: '自动化' },
      { en: 'Schedule', zh: '定时' },
    ],
    frame: 'screen',
    comingIn: '0.7',
  },
];
