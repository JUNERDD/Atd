import type { FeaturesHub } from './types.ts';

/** The head and heading copy of `/features`, the hub that links every capability page. */
export const featuresHub = {
  updated: '2026-11-18',
  copy: {
    en: {
      headTitle: 'Features of the open-source AI agent for Mac — Atd',
      headDescription:
        'What Atd does on your Mac: computer use, screenshots and recording, a selection toolbar, cloud or local models, MCP and skills, automations and apps.',
      title: 'Everything Atd can do on your Mac',
      lede: 'Atd is a free, open-source AI agent for macOS. Start from ⌘ ⇧ Space, selected text or a screenshot, and it works with your models, tools and apps within the permissions you set.',
    },
    zh: {
      headTitle: '功能一览：开源 Mac AI 智能体 — Atd',
      headDescription:
        'Atd 的主要功能：电脑操作、截图与录屏、选区工具栏、云端或本地模型、MCP 与技能、自动化、我的应用与隐私保护。',
      title: 'Atd 能在你的 Mac 上做什么',
      lede: 'Atd 是一款免费开源的 macOS AI 智能体。按下 ⌘ ⇧ Space、选中文字或截一张图即可开始，它会在你设定的权限范围内，调用你的模型、工具和应用完成工作。',
    },
  },
} as const satisfies FeaturesHub;
