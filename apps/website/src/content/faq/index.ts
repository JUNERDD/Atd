import { general } from './general.ts';
import { install } from './install.ts';
import { models } from './models.ts';
import { privacy } from './privacy.ts';
import type { FaqPage } from './types.ts';
import { using } from './using.ts';

export * from './types.ts';

/**
 * The `/faq` page: one module per group. Plain TypeScript with `.ts` import extensions so the
 * prerender scripts can read it under Node's type stripping.
 */
export const faq = {
  updated: '2026-11-24',
  copy: {
    en: {
      headTitle: 'FAQ: the free, open-source AI agent for Mac — Atd',
      headDescription:
        'Answers about Atd, the free, open-source AI agent for macOS: supported Macs, installing and updating, models and cost, data storage and permissions.',
      title: 'Frequently asked questions about Atd',
      lede: 'Short answers about Atd: what it costs, which Macs and models it works with, where your data stays, and how to use its main features.',
    },
    zh: {
      headTitle: '常见问题：免费开源的 Mac AI 智能体 — Atd',
      headDescription:
        '关于 Atd 的常见问题：支持哪些 Mac、如何安装和更新、模型与费用、数据存放位置以及所需的权限。',
      title: 'Atd 常见问题',
      lede: '关于 Atd 的简明解答：费用多少、支持哪些 Mac 和模型、数据存放在哪里，以及主要功能怎么用。',
    },
  },
  groups: [general, install, models, privacy, using],
} as const satisfies FaqPage;
