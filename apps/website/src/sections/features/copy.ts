import type { Localized } from '../../i18n/lang';

/** Your models, where Atd can work, its tools and memory, and the control you keep. */
export const FEATURE_IDS = [
  'providers',
  'computer',
  'extensions',
  'memory',
  'permissions',
  'local',
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

interface FeaturesCopy {
  title: string;
  /** Each description has two short lines, separated by a newline. */
  items: Record<FeatureId, { title: string; body: string }>;
}

export const featuresCopy = {
  en: {
    title: 'Your setup, your rules, your Mac.',
    items: {
      providers: { title: 'Models', body: 'Use your own models,\ncloud or local.' },
      computer: {
        title: 'Computer use',
        body: 'Websites and Mac apps,\nwith your permission.',
      },
      extensions: {
        title: 'Extensions',
        body: 'Skills and subagents,\nMCP and /\u00a0commands.',
      },
      memory: { title: 'Memory', body: 'It learns your habits.\nYou review what stays.' },
      permissions: {
        title: 'Permissions',
        body: 'You control access.\nStop actions anytime.',
      },
      local: { title: 'Runs locally', body: 'No Atd account.\nDirect model access.' },
    },
  },
  zh: {
    title: '你的配置，你的规则，你的 Mac。',
    items: {
      providers: { title: '模型', body: '接入在用的提供商，\n云端本机皆可。' },
      computer: { title: '电脑操作', body: '经你授权，\n操作网站与 Mac 应用。' },
      extensions: { title: '扩展', body: '技能、子代理，\nMCP 和\u00a0/\u00a0命令。' },
      memory: { title: '记忆', body: '学习你的习惯，\n记住什么由你审核。' },
      permissions: { title: '权限', body: '按需授权，\n随时停止或撤销。' },
      local: { title: '本地运行', body: '无需 Atd 账号，\n直连你选择的模型。' },
    },
  },
} satisfies Localized<FeaturesCopy>;
