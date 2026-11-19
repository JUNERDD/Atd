import type { FeaturePage } from './types.ts';

export const apps = {
  slug: 'apps',
  illustration: { case: 'apps' },
  updated: '2026-11-18',
  related: ['mcp-and-skills', 'automations', 'models'],
  posts: [],
  copy: {
    en: {
      name: 'Personal apps',
      summary:
        'Describe a small tool and Atd builds it as an app with its own window, backend and desktop widgets.',
      headTitle: 'Build Personal Mac Apps with AI — Atd',
      headDescription:
        'Describe a small tool and Atd builds it as a personal Mac app with its own window, backend and desktop widgets. Open it from My apps and refine it anytime.',
      title: 'Build personal Mac apps with AI',
      lede: 'Describe a small tool, such as a habit tracker or a budget sheet, and Atd builds it in a conversation. Open it any time from My apps, put its widgets on your desktop, and return to the task whenever you want to change it.',
      sections: [
        {
          id: 'how-it-works',
          title: 'From an idea to an app',
          paragraphs: [
            'Choose Create app in the panel, or describe the tool you want in any conversation. Atd asks only about what would change what the app does, such as what it keeps or whether it needs AI or the web, then builds the smallest version that does the job.',
            'Atd writes the app’s source, builds it and publishes the first version. It tests the app’s backend functions with real inputs and tells you what it verified and what it couldn’t check. When the first version is ready, the app appears in My apps and in Settings › Apps.',
          ],
        },
        {
          id: 'window-backend-widgets',
          title: 'A window, a backend and widgets',
          paragraphs: [
            'Each app opens in its own window, which by default uses the same glass surface as Atd’s panel. An optional backend runs as a sandboxed process that keeps the app’s data in a database, a key-value store or files, and can call web services, AI models, your memory and your MCP servers.',
            'Apps can also offer desktop widgets in small, medium and large sizes, such as today’s items or a count you check often. Add Atd’s App Widget from the macOS widget gallery and choose the app, or drag the app’s card from My apps onto the desktop to pin it.',
          ],
        },
        {
          id: 'refine',
          title: 'Refine it by returning to the task',
          paragraphs: [
            'Ask for a change in the task that built the app, or choose Continue editing in My apps to start a task with the latest source. Each change you ask for becomes one version, however many builds it takes.',
            'Settings › Apps lists every version. Reverting makes an older version current again while newer ones stay listed. The app’s data isn’t rolled back, so data saved by a later version may not work with an older one.',
          ],
        },
        {
          id: 'permissions-and-limits',
          title: 'What apps can access',
          paragraphs: [
            'An app asks the first time it uses AI models, the agent, your memory, your MCP servers or Atd’s web search, explains why it needs it, and Atd remembers your choice. Agent tasks an app starts still ask for approval before steps with side effects, and storage and logs need no permission.',
            'In Settings › Apps you can change an app’s permissions, clear its data or delete it with all its versions.',
          ],
          points: [
            'The app’s window can’t reach the network itself; only its backend can.',
            'The backend can’t start other programs, open listening ports or reach your local network, and writes only inside the app’s own data folder.',
            'A ChatGPT plan connection needs Allow background use before an app’s AI requests can use it.',
            'Pinned widgets show while Atd runs; turn on Open at login to keep them after a restart.',
          ],
        },
      ],
      questions: [
        {
          question: 'Do I need to know how to code?',
          answer:
            'No. You describe what the app should do; Atd asks only about choices that change what the app does, then designs, writes, builds and tests it. Later changes work the same way: say what you want different in the task, and Atd publishes a new version.',
        },
        {
          question: 'Where is an app’s data stored?',
          answer:
            'On your Mac, in the app’s own data folder, which holds its database, files and browser storage. Every version of the app shares that data, and reverting to an older version doesn’t roll it back. Clear data removes everything the app saved but keeps the app and its versions.',
        },
        {
          question: 'Can an app use AI or my other tools?',
          answer:
            'Yes, through its backend and with your consent. The first time an app uses AI models, runs the agent, uses your memory, calls tools on your MCP servers or uses Atd’s web search, Atd asks you and remembers your choice. Change it any time in Settings › Apps.',
        },
        {
          question: 'How do I put an app on my desktop?',
          answer:
            'Drag the app’s card from My apps onto the desktop, or use its pin action; the pin shows one of the app’s widgets, which you can resize within the sizes it supports. You can also add Atd’s App Widget from the macOS widget gallery and choose the app. Widgets need Atd in the Applications folder.',
        },
        {
          question: 'What if a change breaks my app?',
          answer:
            'Revert to an earlier version in Settings › Apps, and it becomes the current version again while newer versions stay listed. You can also tell Atd what went wrong in the task: it can read the app’s diagnostics, including errors in its window and backend crashes, and fix them in a new version.',
        },
      ],
      keywords: [
        'build Mac apps with AI',
        'AI app builder for Mac',
        'personal apps',
        'custom macOS widgets',
        'no-code Mac apps',
        'AI-generated desktop apps',
      ],
    },
    zh: {
      name: '个人应用',
      summary: '说出想要的小工具，Atd 帮你做成有独立窗口、后端和桌面小组件的应用。',
      headTitle: '用 AI 打造自己的 Mac 应用 — Atd',
      headDescription:
        '说出想要的小工具，Atd 帮你做成个人 Mac 应用：独立窗口、自带后端和桌面小组件，随时从“我的应用”打开并继续完善。',
      title: '用 AI 打造自己的 Mac 应用',
      lede: '说出想要的小工具，比如习惯打卡或记账表，Atd 会在对话中把它构建出来。之后随时从“我的应用”打开，把小组件放到桌面上；想改的时候，回到任务里接着说就行。',
      sections: [
        {
          id: 'how-it-works',
          title: '从一个想法到一个应用',
          paragraphs: [
            '在面板中选择“创建应用”，或在任意对话中描述你想要的工具。Atd 只会询问影响应用功能的问题，比如要保存什么、是否需要 AI 或联网，然后先构建能满足需求的最小版本。',
            'Atd 会编写应用的源代码、完成构建并发布第一个版本。它会用真实输入测试应用的后端功能，并告诉你验证了什么、哪些部分无法检查。第一个版本就绪后，应用会出现在“我的应用”和“设置 › 应用”中。',
          ],
        },
        {
          id: 'window-backend-widgets',
          title: '独立窗口、后端与小组件',
          paragraphs: [
            '每个应用都在自己的窗口中打开，窗口默认使用与 Atd 面板相同的玻璃质感。可选的后端运行在沙盒进程中，把应用数据保存在数据库、键值存储或文件里，还可以调用网络服务、AI 模型、你的记忆和 MCP 服务器。',
            '应用还可以提供小、中、大三种尺寸的桌面小组件，比如今天的待办或你常看的计数。在 macOS 小组件库中添加 Atd 的“应用小组件”并选择应用，或把“我的应用”中的应用卡片拖到桌面上即可固定。',
          ],
        },
        {
          id: 'refine',
          title: '回到任务里继续完善',
          paragraphs: [
            '在构建应用的那个任务里直接提出修改，或在“我的应用”中选择“继续编辑”，用最新的源代码开启一个新任务。你提出的每项修改都会成为一个版本，无论其间构建了多少次。',
            '“设置 › 应用”会列出所有版本。回退会让较早的版本重新成为当前版本，较新的版本仍保留在列表中。应用数据不会回滚，因此较新版本保存的数据可能与旧版本不兼容。',
          ],
        },
        {
          id: 'permissions-and-limits',
          title: '应用能访问什么',
          paragraphs: [
            '应用首次使用 AI 模型、Agent、你的记忆、你的 MCP 服务器或 Atd 的网络搜索时，会先询问你并说明原因，Atd 会记住你的选择。应用发起的 Agent 任务在执行有副作用的步骤前仍会请你批准；存储和日志无需授权。',
            '在“设置 › 应用”中可以更改应用的权限、清除它的数据，或连同所有版本一起删除。',
          ],
          points: [
            '应用窗口本身无法联网，只有它的后端可以。',
            '后端不能启动其他程序、监听端口或访问你的本地网络，也只能在应用自己的数据文件夹内写入。',
            '使用 ChatGPT 订阅连接时，需要先开启“允许后台调用”，应用的 AI 请求才能使用它。',
            '固定到桌面的小组件仅在 Atd 运行时显示；开启“登录时打开”后，重启也会保留。',
          ],
        },
      ],
      questions: [
        {
          question: '需要会写代码吗？',
          answer:
            '不需要。你只要说清楚应用要做什么，Atd 会负责设计、编写、构建和测试，只询问会影响应用功能的选择。之后的修改也一样：在任务里说出想改的地方，Atd 就会发布一个新版本。',
        },
        {
          question: '应用的数据保存在哪里？',
          answer:
            '保存在你的 Mac 上，位于应用自己的数据文件夹中，包括它的数据库、文件和浏览器存储。应用的所有版本共用这些数据，回退到旧版本也不会让数据回滚。“清除数据”会移除应用保存的所有内容，但保留应用及其版本。',
        },
        {
          question: '应用能使用 AI 或我的其他工具吗？',
          answer:
            '可以，通过应用的后端，并且需要你同意。应用首次使用 AI 模型、运行 Agent、使用你的记忆、调用 MCP 服务器上的工具或使用 Atd 的网络搜索时，Atd 会询问你并记住你的选择，之后可以随时在“设置 › 应用”中更改。',
        },
        {
          question: '怎样把应用放到桌面上？',
          answer:
            '把“我的应用”中的应用卡片拖到桌面，或使用它的固定操作；固定后会显示应用的一个小组件，可以在它支持的尺寸范围内调整大小。也可以在 macOS 小组件库中添加 Atd 的“应用小组件”并选择这个应用。小组件需要 Atd 位于“应用程序”文件夹中。',
        },
        {
          question: '修改后应用出问题了怎么办？',
          answer:
            '在“设置 › 应用”中回退到较早的版本，它会重新成为当前版本，较新的版本仍保留在列表中。你也可以在任务里告诉 Atd 出了什么问题：它能读取应用的诊断信息，包括窗口中的错误和后端崩溃，并在新版本中修复。',
        },
      ],
      keywords: [
        '用 AI 做 Mac 应用',
        'AI 应用生成',
        '个人应用',
        'macOS 桌面小组件',
        '无代码 Mac 应用',
        '我的应用',
      ],
    },
  },
} as const satisfies FeaturePage;
