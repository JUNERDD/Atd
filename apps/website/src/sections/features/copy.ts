import type { Localized } from '../../i18n/lang';
import type { FeatureId } from './glyphs';

interface FeaturesCopy {
  /** The plate's printed name, as the nav calls the section. */
  label: string;
  title: string;
  /** One line each: the cell's glyph carries the rest. */
  items: Record<FeatureId, { title: string; body: string }>;
}

export const featuresCopy = {
  en: {
    label: 'Features',
    title: 'Your models, your tools, your rules.',
    items: {
      providers: {
        title: 'Models',
        body: 'Bring the providers you use, in the cloud or on your Mac.',
      },
      extensions: {
        title: 'Extensions',
        body: 'Skills, subagents, MCP servers and saved /\u00a0commands.',
      },
      memory: { title: 'Memory', body: 'It learns how you work. You review what it keeps.' },
      permissions: { title: 'Permissions', body: 'You decide what it may do without asking.' },
    },
  },
  zh: {
    label: '功能',
    title: '你的模型，你的工具，你的规则。',
    items: {
      providers: { title: '模型', body: '接入你在用的提供商，云端或本机皆可。' },
      extensions: { title: '扩展', body: '技能、子代理、MCP 服务器，以及用 /\u00a0运行的命令。' },
      memory: { title: '记忆', body: '它会学习你的工作方式，记住什么由你审核。' },
      permissions: { title: '权限', body: '无需询问时能做多少，由你决定。' },
    },
  },
} satisfies Localized<FeaturesCopy>;
