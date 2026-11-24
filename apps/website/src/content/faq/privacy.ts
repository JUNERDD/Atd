import type { FaqGroup } from './types.ts';

/** Where data lives, macOS permissions, approvals, and memory controls. */
export const privacy = {
  id: 'privacy-and-data',
  title: { en: 'Privacy and data', zh: '隐私与数据' },
  entries: [
    {
      id: 'where-is-data-stored',
      question: { en: 'Where does Atd store my data?', zh: 'Atd 把我的数据存在哪里？' },
      answer: {
        en: [
          'On your Mac. The installed app keeps task history, settings and memories in ~/Library/Application Support/AgentService, and personal skills and agents in ~/.atd. Provider and MCP credentials are stored in the macOS keychain, and browser environments for computer use keep their sign-in data in separate profiles on your Mac.',
          'There is no Atd account. Model requests go directly from your Mac to the providers you configure, carrying the prompt, conversation context and any attachments or tool results the task includes.',
        ],
        zh: [
          '保存在你的 Mac 上。安装版会把任务历史、设置和记忆保存在 ~/Library/Application Support/AgentService，个人技能和子代理保存在 ~/.atd。提供商和 MCP 的凭据存放在 macOS 钥匙串中；电脑操作使用的浏览器环境会把登录数据保存在 Mac 上单独的浏览器配置中。',
          'Atd 没有账号体系。模型请求会从你的 Mac 直接发往你配置的提供商，内容包括提示词、对话上下文，以及任务中附带的附件或工具结果。',
        ],
      },
      see: 'privacy',
    },
    {
      id: 'macos-permissions',
      question: { en: 'What macOS permissions does Atd need?', zh: 'Atd 需要哪些 macOS 权限？' },
      answer: {
        en: [
          'Only the ones for features you use, and Atd asks for each when you first use the feature that needs it. The selection toolbar needs Accessibility (called Device Control and Data Access on newer macOS versions), and screenshots and screen recordings need Screen Recording.',
          'Computer use in Mac apps needs the same app-control access plus Screen Recording; Settings → Computer use shows their status and opens System Settings for you. If macOS blocks reading a file you attach, Atd tells you why and opens Privacy & Security › Files & Folders directly. You can also inspect permissions and system health in Diagnostics beside About in Settings, or turn any permission off again in System Settings › Privacy & Security.',
        ],
        zh: [
          '只需要你所用功能对应的权限，Atd 会在你第一次使用该功能时请求。选区工具栏需要“辅助功能”（较新的 macOS 中称为“设备控制和数据访问”），截图和录屏需要“屏幕录制”。',
          '在 Mac 应用中进行电脑操作，需要同样的应用控制权限和“屏幕录制”；“设置 → 电脑操作”会显示它们的状态，并能直接打开系统设置。如果 macOS 阻止读取你附加的文件，Atd 会说明原因并提供一键打开“隐私与安全性 › 文件与文件夹”的入口。你也可以在设置底栏“关于”旁的“系统诊断”中检查权限与运行状态，并随时在“系统设置 › 隐私与安全性”中关闭任意权限。',
        ],
      },
      see: 'privacy',
    },
    {
      id: 'approvals',
      question: {
        en: 'Does Atd ask before it runs commands or changes files?',
        zh: 'Atd 运行命令或修改文件前会先问我吗？',
      },
      answer: {
        en: [
          'That depends on the task’s approval mode. Manual approval asks before every file or terminal action; Auto approval has a model check each action against your request, running safe ones and still asking about risky ones; Always allow never asks. New installations start on Auto approval.',
          'Change a task’s mode from the composer, and the default for new tasks in Settings → Permissions, which also holds the shell allowlist. Switching to Always allow asks you to confirm first.',
        ],
        zh: [
          '取决于任务的权限级别。“手动批准”会在每次文件或终端操作前询问；“自动批准”由模型对照你的请求检查每个操作，安全的直接执行，有风险的仍会询问；“始终允许”则不再询问。新安装默认使用“自动批准”。',
          '每个任务都可以在输入框中切换级别，新任务的默认级别在“设置 → 权限”中设置，命令允许列表也在那里。切换到“始终允许”前，Atd 会先请你确认。',
        ],
      },
      see: 'privacy',
    },
    {
      id: 'memory',
      question: {
        en: 'Can I see and delete what Atd remembers?',
        zh: '能查看和删除 Atd 记住的内容吗？',
      },
      answer: {
        en: [
          'Yes. Settings → Memory lists every saved memory, filtered by user profile, preferences and facts, corrections and learnings, or tool preferences, and you can edit or delete each one. Memories are stored on your Mac.',
          'Turn off Learn automatically to stop saving new memories while still using the saved ones, or turn on Ask before saving to review each learned memory before it’s kept. Learning uses your configured model and may make extra model calls.',
        ],
        zh: [
          '可以。“设置 → 记忆”会列出所有已保存的记忆，可按用户画像、偏好与事实、纠正与经验或工具偏好筛选，每一条都能编辑或删除。记忆保存在你的 Mac 上。',
          '关闭“自动学习”后不再保存新的记忆，已保存的记忆仍会继续使用；开启“保存前询问”后，自动学到的记忆要经你接受才会保存。学习会使用你配置的模型，可能产生额外的模型调用。',
        ],
      },
      see: 'privacy',
    },
  ],
} as const satisfies FaqGroup;
