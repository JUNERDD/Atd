import type { Localized } from '../../i18n/lang';
import type { FeatureId } from './glyphs';

export type TierId = 'manual' | 'auto' | 'always';

interface Feature {
  title: string;
  body: string;
}

interface FeaturesCopy {
  kicker: string;
  title: string;
  lede: string;
  items: Record<FeatureId, Feature>;
  /** Sample task history in the Conversations tile: a title and its state. */
  tasks: { title: string; state: string }[];
  /** Sample steps in the Tool activity tile. */
  steps: { kind: string; target: string; result: string }[];
  /** The sample message in the Composer tile, with a file chip and a command chip. */
  composer: { lead: string; file: string; join: string; command: string };
  tiers: {
    legend: string;
    options: Record<TierId, { label: string; description: string }>;
    allowlistLabel: string;
    allowlist: string;
  };
}

export const featuresCopy = {
  en: {
    kicker: 'Features',
    title: 'A small panel with a full workbench.',
    lede: 'Conversations, tools, permissions and memory, all in a 420-point window that stays out of your way.',
    items: {
      conversations: {
        title: 'Conversations',
        body: 'Replies stream in while the agent works. Follow up, stop and resume, or recover a run that was cut short; each task keeps the model it started with.',
      },
      composer: {
        title: 'Composer',
        body: 'Type @ for files and / for commands and skills, and each one lands as a chip in your sentence. Add attachments, selected text or the clipboard; Enter never cuts off an input method.',
      },
      tools: {
        title: 'Tool activity',
        body: 'Every step shows up inline: file diffs, terminal output, web lookups, the todo list and full subagent transcripts.',
      },
      permissions: {
        title: 'Permissions',
        body: 'Decide how much the agent may do without asking. New tasks start from your default, and any task can change its own tier from the composer.',
      },
      providers: {
        title: 'Providers',
        body: 'Connect the models you use as named connections, each with its own credentials and default model. Start from the catalog, or add a local or custom one.',
      },
      commands: {
        title: 'Commands',
        body: 'Save instructions you repeat with variables, typed parameters, a shortcut and their own tool settings. Suggested wording is previewed first and easy to undo.',
      },
      extensions: {
        title: 'Extensions',
        body: 'Add skills, subagents and MCP servers, including Markdown agents from ~/.atd/agents. Turn each one on or off for the next run.',
      },
      memory: {
        title: 'Memory',
        body: 'Atd remembers your preferences across tasks. Search, edit or delete what it keeps, and pause learning whenever you like.',
      },
      languages: {
        title: 'Languages',
        body: 'English and Simplified Chinese. The first launch follows the language of your Mac.',
      },
      updates: {
        title: 'Updates',
        body: 'Installed copies update themselves, so new releases arrive without another download.',
      },
    },
    tasks: [
      { title: 'Sort the screenshots on my Desktop', state: 'Done' },
      { title: 'Fix the failing parser test', state: 'Streaming' },
      { title: 'Draft the release notes', state: 'Resumed' },
    ],
    steps: [
      { kind: 'Edit', target: 'src/parser.ts', result: '+12 −3' },
      { kind: 'Run', target: 'pnpm test', result: 'passed' },
      { kind: 'Web', target: 'nodejs.org/api', result: 'read' },
      { kind: 'Todo', target: '3 of 5 done', result: '' },
    ],
    composer: { lead: 'Check', file: 'parser.ts', join: 'then run', command: 'review' },
    tiers: {
      legend: 'Permission level',
      options: {
        manual: { label: 'Manual', description: 'Ask before every file or terminal action.' },
        auto: {
          label: 'Auto',
          description:
            'A model checks each action against your request. Safe actions run; risky ones still ask.',
        },
        always: {
          label: 'Always allow',
          description:
            'Never ask. Terminal commands and files outside the task folder run unattended.',
        },
      },
      allowlistLabel: 'Shell allowlist',
      allowlist:
        'Commands that start with an entry you trust run right away: no prompt under Manual, no review under Auto.',
    },
  },
  zh: {
    kicker: '功能',
    title: '面板虽小，工具齐全。',
    lede: '对话、工具、权限与记忆，都收在一个 420 pt 宽、从不碍事的窗口里。',
    items: {
      conversations: {
        title: '对话',
        body: '回复随智能体的工作实时呈现。可以追问、停止再继续，被中断的运行也能恢复；每个任务都沿用开始时的模型。',
      },
      composer: {
        title: '输入框',
        body: '输入 @ 引用文件，输入 / 调用命令和技能，它们会以标签嵌在句中。还能附加文件、选中文本或剪贴板内容；使用输入法时，回车不会误发送。',
      },
      tools: {
        title: '工具活动',
        body: '每一步都在对话中展开：文件差异、终端输出、网页工具、待办清单，以及子代理的完整记录。',
      },
      permissions: {
        title: '权限',
        body: '决定智能体无需询问就能做什么。新任务沿用你设定的默认级别，每个任务也能在输入框中单独调整。',
      },
      providers: {
        title: '提供商',
        body: '把常用的模型接成具名连接，每个连接都有自己的凭据和默认模型。可从目录中选择，也能添加本地或自定义连接。',
      },
      commands: {
        title: '命令',
        body: '把反复使用的指令存成命令，支持变量、类型化参数、快捷键和单独的工具设置。建议的措辞会先预览，也能轻松撤销。',
      },
      extensions: {
        title: '扩展',
        body: '添加技能、子代理和 MCP 服务器，包括 ~/.atd/agents 中的 Markdown 智能体。每一项都能为下一次运行单独开关。',
      },
      memory: {
        title: '记忆',
        body: 'Atd 会跨任务记住你的偏好。你可以搜索、编辑或删除这些记忆，也能随时暂停学习。',
      },
      languages: {
        title: '语言',
        body: '支持英文和简体中文，首次启动时跟随 Mac 的系统语言。',
      },
      updates: {
        title: '更新',
        body: '已安装的 Atd 会自行更新，新版本无需再次下载。',
      },
    },
    tasks: [
      { title: '整理桌面上的截图', state: '已完成' },
      { title: '修复失败的解析器测试', state: '输出中' },
      { title: '起草更新说明', state: '已继续' },
    ],
    steps: [
      { kind: '编辑', target: 'src/parser.ts', result: '+12 −3' },
      { kind: '运行', target: 'pnpm test', result: '通过' },
      { kind: '网页', target: 'nodejs.org/api', result: '已读取' },
      { kind: '待办', target: '已完成 3/5', result: '' },
    ],
    composer: { lead: '检查', file: 'parser.ts', join: '再运行', command: 'review' },
    tiers: {
      legend: '权限级别',
      options: {
        manual: { label: '手动', description: '每次文件或终端操作前都先询问。' },
        auto: {
          label: '自动',
          description: '由模型对照你的请求检查每个操作：安全的直接执行，有风险的仍会询问。',
        },
        always: {
          label: '始终允许',
          description: '不再询问。终端命令和任务文件夹外的文件将在无人值守下运行。',
        },
      },
      allowlistLabel: '命令允许列表',
      allowlist: '以你信任的条目开头的命令会直接运行：手动批准时不再询问，自动批准时不再审查。',
    },
  },
} satisfies Localized<FeaturesCopy>;
