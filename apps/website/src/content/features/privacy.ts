import type { FeaturePage } from './types.ts';

export const privacy = {
  slug: 'privacy',
  illustration: {
    scene: {
      en: 'Permissions settings show Auto approval selected between Manual approval and Always allow, above a shell allowlist with git status, git diff, npm test and ls.',
      zh: '权限设置中选中了“自动批准”，两侧是“手动批准”和“始终允许”，下方的命令允许列表包含 git status、git diff、npm test 和 ls。',
    },
  },
  updated: '2026-11-24',
  related: ['models', 'computer-use', 'automations'],
  posts: ['atd-0-12-1', 'atd-0-12-0', 'atd-0-11-1', 'atd-0-11-0', 'atd-0-10-6'],
  copy: {
    en: {
      name: 'Privacy and control',
      summary:
        'Local storage, keychain credentials, no Atd account, and approval controls you set for every task.',
      headTitle: 'Private, Local-First AI Agent for Mac — Atd',
      headDescription:
        'Atd keeps tasks, settings and memories on your Mac, stores credentials in the keychain and needs no Atd account. You decide what each task may do.',
      title: 'A private, local-first AI agent for Mac',
      lede: 'Atd keeps your task history, settings and memories on your Mac, sends model requests to the providers you choose, and lets you decide what each task may do. It’s free, open source under the MIT License, and needs no Atd account.',
      sections: [
        {
          id: 'local-storage',
          title: 'Your data stays on your Mac',
          paragraphs: [
            'Atd runs a local agent service that starts when you open the app and stops when you quit. Task history, settings and memories are stored in ~/Library/Application Support/AgentService, and personal skills and agents in ~/.atd.',
            'Model provider and MCP credentials are kept in your Mac’s keychain. Browser environments for computer use keep their sign-in data in separate profiles on your Mac, and each personal app keeps its data in its own folder.',
          ],
        },
        {
          id: 'no-account',
          title: 'No Atd account, your own providers',
          paragraphs: [
            'There’s no Atd account to create. Connect your own model providers in Settings › Models with an account sign-in, an API key or a local endpoint, and requests go to the providers you configure. Tools and MCP servers a task uses can reach the files and services their configuration and the task’s permissions allow.',
            'Before you connect a ChatGPT plan, Atd shows what the connection shares and asks you to agree. Its sign-in tokens stay in your keychain and aren’t sent to an Atd server, and background use by automations, memory maintenance and apps stays off until you allow it.',
          ],
        },
        {
          id: 'approvals',
          title: 'Approve what each task can do',
          paragraphs: [
            'Every task has an approval mode you can change from the composer, and Settings › Permissions sets the default for new tasks.',
          ],
          points: [
            'Manual approval asks before every file or terminal action.',
            'Auto approval has a model check each action against your request: safe actions run and risky ones still ask. New installations start here.',
            'Always allow never asks, including for terminal commands and files outside the task folder, and Atd asks you to confirm before switching to it.',
            'The shell allowlist lets commands that start with an entry you add run right away; commands that chain, redirect or substitute always ask.',
            'Computer use asks for access to each app or website a task needs, and Stop all in Settings › Computer use stops computer actions across tasks and automations.',
          ],
        },
        {
          id: 'memory',
          title: 'Memory you can review and pause',
          paragraphs: [
            'Atd learns stable preferences and clear corrections as you work. In Settings › Memory you can read, filter, edit, turn off and delete each memory, turn on Ask before saving so learned memories wait in Suggestions until you accept them, or turn off Learn automatically; memories you already have stay usable while learning is off.',
            'Learning uses your configured model and may make additional model calls. Automation runs can read memory but never add to it.',
          ],
        },
        {
          id: 'captures-and-source',
          title: 'Careful captures and open source',
          paragraphs: [
            'Text you cover with the mosaic tool or Cover Sensitive Info can’t be picked and is left out of the recognized text sent with a screenshot. A screen recording sends its detected steps and on-device narration, not the video file itself.',
            'Atd is open source under the MIT License, and release installers and updates are signed with an Apple Developer ID certificate and notarized by Apple, so anyone can verify both the source code and the shipped app. If macOS blocks reading an attached file, Atd explains why and opens Privacy & Security › Files & Folders directly. When troubleshooting, open Diagnostics beside About in Settings to run the 7-layer Doctor, test live probes without recording text or pixels, or preview and export a redacted support bundle that scrubs personal paths, keys, tokens and conversation content.',
          ],
        },
      ],
      questions: [
        {
          question: 'Where do my prompts go?',
          answer:
            'To the model providers you configure in Settings › Models, together with the conversation context, attachments and tool results the task includes. Tools and MCP servers a task uses can also reach the services their configuration allows. Your task history, settings and memories stay on your Mac, and there’s no Atd account.',
        },
        {
          question: 'Where are my API keys stored?',
          answer:
            'In your Mac’s keychain, along with sign-ins and MCP credentials. If macOS blocks access to a saved key, for example after a signing certificate update, Atd flags the affected connection in Settings › Models so you can enter the key or sign in again without losing its other settings.',
        },
        {
          question: 'Can Atd run commands without asking?',
          answer:
            'Only if you let it. Manual approval asks before every file or terminal action, Auto approval lets a model allow safe actions and still asks about risky ones, and Always allow runs everything without asking once you confirm it. Commands that match your shell allowlist run right away under Manual and Auto approval.',
        },
        {
          question: 'How do I stop Atd from learning about me?',
          answer:
            'Turn off Learn automatically in Settings › Memory. Nothing new is saved while it’s off, and the agent can still use memories you already have. To review first instead, turn on Ask before saving, and learned memories wait in Suggestions until you accept them.',
        },
        {
          question: 'Can I keep sensitive details out of a screenshot?',
          answer:
            'Yes. Cover them with the mosaic tool or Cover Sensitive Info before you ask about the screenshot. Covered text can’t be picked and is excluded from the recognized text sent with the capture.',
        },
      ],
      keywords: [
        'private AI assistant for Mac',
        'local-first AI agent',
        'AI agent without an account',
        'API keys in macOS keychain',
        'AI approval controls',
        'open-source AI agent for macOS',
        'AI memory controls',
      ],
    },
    zh: {
      name: '隐私与控制',
      summary: '数据存在本机，凭据存入钥匙串，无需 Atd 账号，每个任务能做什么由你决定。',
      headTitle: '本地优先的 Mac AI 智能体：隐私与权限 — Atd',
      headDescription:
        'Atd 把任务、设置和记忆保存在你的 Mac 上，凭据存入钥匙串，无需 Atd 账号；每个任务能做什么，由你决定。',
      title: '本地优先、由你掌控的 Mac AI 智能体',
      lede: 'Atd 把任务记录、设置和记忆保存在你的 Mac 上，模型请求发往你选择的服务商，每个任务能做什么也由你决定。它免费、以 MIT 许可证开源，而且无需 Atd 账号。',
      sections: [
        {
          id: 'local-storage',
          title: '数据留在你的 Mac 上',
          paragraphs: [
            'Atd 在本机运行一个 Agent 服务：打开应用时启动，退出时停止。任务记录、设置和记忆保存在 ~/Library/Application Support/AgentService，个人技能和子代理保存在 ~/.atd。',
            '模型服务商和 MCP 的凭据保存在 Mac 的钥匙串中。电脑操作使用的浏览器环境把登录数据保存在本机独立的浏览器配置中，每个个人应用的数据也保存在它自己的文件夹里。',
          ],
        },
        {
          id: 'no-account',
          title: '无需 Atd 账号，直连你的服务商',
          paragraphs: [
            '不需要注册 Atd 账号。在“设置 › 模型”中用账号登录、API 密钥或本地端点连接你自己的模型服务商，请求会发往你配置的服务商。任务使用的工具和 MCP 服务器，能访问它们自身配置和任务权限所允许的文件与服务。',
            '连接 ChatGPT 订阅前，Atd 会说明这个连接会共享哪些数据，并请你同意。它的登录凭据保存在钥匙串中，不会发送到 Atd 服务器；自动化、记忆整理和应用等后台调用默认关闭，由你决定是否允许。',
          ],
        },
        {
          id: 'approvals',
          title: '每个任务能做什么，由你批准',
          paragraphs: [
            '每个任务都有自己的权限级别，可以在输入框中切换；新任务的默认级别在“设置 › 权限”中设定。',
          ],
          points: [
            '手动批准：每次文件或终端操作前都先询问。',
            '自动批准：由模型对照你的请求检查每个操作，安全的直接执行，有风险的仍会询问。新安装默认使用此级别。',
            '始终允许：不再询问，包括终端命令和任务文件夹外的文件；切换前 Atd 会请你确认。',
            '命令允许列表：以你添加的条目开头的命令直接运行；包含串联、重定向或替换的命令始终需要确认。',
            '电脑操作会逐一请求任务所需应用和网站的访问权限；在“设置 › 电脑操作”中选择“全部停止”，可以停止所有任务和自动化中的电脑操作。',
          ],
        },
        {
          id: 'memory',
          title: '记忆可以查看，也可以暂停学习',
          paragraphs: [
            'Atd 会在工作中记住稳定的偏好和明确的纠正。在“设置 › 记忆”中，你可以查看、筛选、编辑、停用和删除每条记忆；开启“保存前询问”后，自动学到的记忆会先放在“建议”里，等你接受后再保存；也可以关闭“自动学习”，已有的记忆仍可继续使用。',
            '学习会使用你配置的模型，并可能产生额外的模型调用。自动化的运行可以读取记忆，但不会写入记忆。',
          ],
        },
        {
          id: 'captures-and-source',
          title: '截图保护与开源代码',
          paragraphs: [
            '用马赛克或“遮盖敏感信息”盖住的文字无法被选取，也不会出现在随截图发送的识别文字中。屏幕录制发送的是识别出的操作步骤和在本机生成的旁白，而不是视频文件本身。',
            'Atd 以 MIT 许可证开源，正式版安装包与自动更新均使用 Apple Developer ID 证书签名并通过 Apple 公证，任何人都可以审阅源码并校验发布包。当 macOS 阻止读取附件文件时，Atd 会说明原因并一键打开“隐私与安全性 › 文件与文件夹”。需要排障时，可在设置底栏“关于”旁打开“系统诊断”，运行七层自检、执行不记录文字与画面的实时探针，或在导出前预览自动擦除个人路径、密钥、令牌与对话内容的脱敏诊断支持包。',
          ],
        },
      ],
      questions: [
        {
          question: '我的提示词会发到哪里？',
          answer:
            '发往你在“设置 › 模型”中配置的模型服务商，同时附带任务中的对话上下文、附件和工具结果。任务使用的工具和 MCP 服务器，也能访问它们配置所允许的服务。你的任务记录、设置和记忆都保存在本机，而且无需 Atd 账号。',
        },
        {
          question: 'API 密钥保存在哪里？',
          answer:
            '保存在 Mac 的钥匙串中，账号登录凭据和 MCP 凭据也一样。如果 macOS 阻止访问已保存的密钥（例如签名证书更新之后），Atd 会在“设置 › 模型”中标出受影响的连接，你重新填写密钥或重新登录即可，其他设置都会保留。',
        },
        {
          question: 'Atd 会不经询问就运行命令吗？',
          answer:
            '只有你允许时才会。“手动批准”在每次文件或终端操作前都会询问；“自动批准”由模型放行安全的操作，有风险的仍会询问；“始终允许”在你确认开启后，所有操作都不再询问。命令允许列表中的命令在手动批准和自动批准下都会直接运行。',
        },
        {
          question: '怎样让 Atd 不再学习关于我的信息？',
          answer:
            '在“设置 › 记忆”中关闭“自动学习”。关闭期间不会保存新的记忆，已有的记忆仍可使用。如果想先审核再保存，可以开启“保存前询问”，自动学到的记忆会先放在“建议”里，等你接受。',
        },
        {
          question: '截图里的敏感信息能不发出去吗？',
          answer:
            '可以。在就截图提问之前，用马赛克或“遮盖敏感信息”盖住这些内容。被遮盖的文字无法被选取，也不会出现在随截图发送的识别文字中。',
        },
      ],
      keywords: [
        'Mac 本地 AI 助手',
        '本地优先 AI 智能体',
        '无需账号的 AI 工具',
        'API 密钥 钥匙串',
        'AI 权限控制',
        '开源 macOS AI 智能体',
        'AI 记忆管理',
      ],
    },
  },
} as const satisfies FeaturePage;
