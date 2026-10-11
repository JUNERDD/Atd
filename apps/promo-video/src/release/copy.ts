/**
 * The release film's narrative voice, per language: the title and its line, the kinetic words each
 * section lands on the beat, and the sign-off. What appears inside the product's interface is each
 * scene's `content.ts`; `content.ts` beside this file registers both with the fonts.
 */
import type { Lang } from '../copy.ts';

export interface ReleaseCopy {
  title: string;
  titleLine: string;
  writeback: { select: string; ask: string; back: string };
  choose: { tap: string; hold: string; where: string };
  yours: { plan: string; effort: string; light: string; order: string };
  everything: {
    lead: string;
    /** One word per mosaic tile, in tile order. */
    words: readonly string[];
  };
  finale: { line: string; url: string; specs: string };
}

export const releaseCopy = {
  en: {
    title: 'Atd 0.8',
    titleLine: 'It writes back.',
    writeback: { select: 'Select.', ask: 'Ask.', back: 'It writes back.' },
    choose: { tap: 'Tap to run.', hold: 'Hold to choose.', where: 'This time, put it here.' },
    yours: {
      plan: 'Your ChatGPT plan.',
      effort: 'Effort, per command.',
      light: 'Light runs land fast.',
      order: 'Your order, everywhere.',
    },
    everything: {
      lead: 'And everything Atd already does.',
      words: ['Tasks', 'Apps', 'Automations', 'Memory', 'Skills', 'Subagents', 'MCP', 'Capture'],
    },
    finale: {
      line: 'Ask anywhere. It writes back.',
      url: 'atd.best',
      specs: 'Version 0.8 · macOS 26 · Apple silicon',
    },
  },
  zh: {
    title: 'Atd 0.8',
    titleLine: '写回原处。',
    writeback: { select: '选中。', ask: '提问。', back: '写回原处。' },
    choose: { tap: '轻点，即运行。', hold: '按住，再选择。', where: '这一次，写在这里。' },
    yours: {
      plan: '用你的 ChatGPT 套餐。',
      effort: '每条命令，各自的推理力度。',
      light: '轻量运行，转瞬即达。',
      order: '你的顺序，处处一致。',
    },
    everything: {
      lead: '还有 Atd 一直在做的一切。',
      words: ['任务', '应用', '自动化', '记忆', '技能', '子代理', 'MCP', '截图'],
    },
    finale: {
      line: '随处提问，写回原处。',
      url: 'atd.best',
      specs: '版本 0.8 · macOS 26 · Apple 芯片',
    },
  },
} as const satisfies Record<Lang, ReleaseCopy>;
