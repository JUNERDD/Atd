import type { Localized } from '../../i18n/lang';

/** The capabilities in reading order: your setup (models, tools, memory), your rules, your Mac. */
export const FEATURE_IDS = ['providers', 'extensions', 'memory', 'permissions', 'local'] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

interface FeaturesCopy {
  title: string;
  /** Each capability's name and its one line. */
  items: Record<FeatureId, { title: string; body: string }>;
}

export const featuresCopy = {
  en: {
    title: 'Your setup, your rules, your Mac.',
    items: {
      providers: { title: 'Models', body: 'Use the providers you have, cloud or local.' },
      extensions: {
        title: 'Extensions',
        body: 'Skills, subagents, MCP servers and /\u00a0commands.',
      },
      memory: { title: 'Memory', body: 'It learns how you work. You review what it keeps.' },
      permissions: { title: 'Permissions', body: 'You decide what it may do without asking.' },
      local: { title: 'Runs locally', body: 'No account, and no Atd server in between.' },
    },
  },
  zh: {
    title: '你的配置，你的规则，你的 Mac。',
    items: {
      providers: { title: '模型', body: '接入在用的提供商，云端本机皆可。' },
      extensions: { title: '扩展', body: '技能、子代理、MCP 和\u00a0/\u00a0命令。' },
      memory: { title: '记忆', body: '学习你的习惯，记住什么由你审核。' },
      permissions: { title: '权限', body: '无需询问能做多少，由你决定。' },
      local: { title: '本地运行', body: '无需账号，不经 Atd 服务器中转。' },
    },
  },
} satisfies Localized<FeaturesCopy>;
