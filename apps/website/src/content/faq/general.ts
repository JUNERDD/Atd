import type { FaqGroup } from './types.ts';

/** What Atd is, what it costs, whether it needs an account, and its languages. */
export const general = {
  id: 'general',
  title: { en: 'General', zh: '概览' },
  entries: [
    {
      id: 'what-is-atd',
      question: { en: 'What is Atd?', zh: 'Atd 是什么？' },
      answer: {
        en: [
          'Atd is a free, open-source AI agent for macOS that lives in a small desktop panel. Press ⌘ ⇧ Space, select text in an app, or capture your screen to start a task, and Atd works on it with the models you connect, showing its tool activity, file changes and terminal output as it goes.',
          'Beyond conversation, Atd can work in websites and Mac apps with your permission, run automations on a schedule or when files arrive, use MCP servers, skills and subagents, and build small personal apps you can open again.',
        ],
        zh: [
          'Atd 是一款免费开源的 macOS AI 智能体，常驻在桌面上的一个小面板里。按下 ⌘ ⇧ Space、在应用中选中文字或截一张图，就能开始一个任务；Atd 会用你接入的模型完成它，并实时显示工具调用、文件改动和终端输出。',
          '除了对话，Atd 还能经你授权操作网站和 Mac 应用，按计划或在文件到达时运行自动化，使用 MCP 服务器、技能和子代理，并为你搭建可以随时再打开的个人小应用。',
        ],
      },
    },
    {
      id: 'what-does-atd-stand-for',
      question: { en: 'What does Atd stand for?', zh: 'Atd 这个名字是什么意思？' },
      answer: {
        en: [
          'Atd stands for “anything, anytime, anywhere, to do.” It is the free, open-source AI desktop agent app for macOS published at atd.best and github.com/JUNERDD/Atd.',
        ],
        zh: [
          'Atd 代表 “anything, anytime, anywhere, to do”。它是发布在 atd.best 与 github.com/JUNERDD/Atd 的免费开源 macOS AI 桌面智能体应用。',
        ],
      },
    },
    {
      id: 'is-atd-free',
      question: { en: 'Is Atd free and open source?', zh: 'Atd 免费吗？开源吗？' },
      answer: {
        en: [
          'Yes. Atd is free to download and use, and its source code is published on GitHub (github.com/JUNERDD/Atd) under the MIT License. Atd itself charges nothing.',
          'The only costs come from the AI models you use. Cloud providers may charge under your own account or plan, such as pay-as-you-go API billing or a subscription allowance, while a local model runs on your own hardware.',
        ],
        zh: [
          '是的。Atd 可以免费下载和使用，源代码以 MIT 许可证发布在 GitHub（github.com/JUNERDD/Atd）上。Atd 本身不收取任何费用。',
          '可能产生的费用只来自你使用的 AI 模型：云端提供商会按你自己的账号或套餐计费，例如按量计费的 API 或订阅额度；本地模型则运行在你自己的硬件上。',
        ],
      },
      see: 'models',
    },
    {
      id: 'do-i-need-an-account',
      question: { en: 'Do I need an account to use Atd?', zh: '使用 Atd 需要注册账号吗？' },
      answer: {
        en: [
          'No. Atd has no account of its own: download it, open it and connect a model. In Settings → Models, add a provider connection with an account sign-in (such as a ChatGPT plan), an API key, or a local endpoint that needs no key.',
          'Each connection uses the credentials of the provider it connects to, and Atd stores them in your Mac’s keychain.',
        ],
        zh: [
          '不需要。Atd 没有自己的账号体系：下载、打开，再接入一个模型即可。在“设置 → 模型”中添加提供商连接时，可以登录账号（例如 ChatGPT 订阅）、填写 API 密钥，或连接无需密钥的本地端点。',
          '每个连接使用对应提供商的凭据，Atd 会把它们保存在 Mac 的钥匙串中。',
        ],
      },
      see: 'models',
    },
    {
      id: 'languages',
      question: { en: 'Is Atd available in Chinese?', zh: 'Atd 支持中文界面吗？' },
      answer: {
        en: [
          'Yes. Atd’s interface is available in English and Simplified Chinese. It follows your Mac’s language until you choose one with the Language selector at the top of the Settings window, and the change applies right away without restarting.',
        ],
        zh: [
          '支持。Atd 的界面提供英文和简体中文。在你手动选择之前，它会跟随 Mac 的系统语言；在设置窗口顶部的“语言”选择器中切换后会立即生效，无需重启。',
        ],
      },
    },
  ],
} as const satisfies FaqGroup;
