import { caseLayers, type CaseLayer } from './case-layers';
import { mediaUrl } from './media';
import type { Localized } from '../i18n/lang';

interface CaseImage {
  src: string;
  alt: Localized<string>;
}

interface Case {
  id: string;
  label: Localized<string>;
  title: Localized<string>;
  description: Localized<string>;
  /** The flat export, linked as the original. */
  image: CaseImage;
  /** The same scene as layers over the shared desktop, which the showcase animates. */
  layers: readonly CaseLayer[];
}

/** Figma scenes share the canonical desktop and a 1440 × 900 canvas. Source nodes, layer exports and update instructions live in public/cases/README.md. */
export const cases = [
  {
    id: 'selection-toolbar',
    label: { en: 'Selection toolbar', zh: '选区工具栏' },
    title: { en: 'Start with the words in front of you.', zh: '选中文字，就能接着做。' },
    description: {
      en: 'Ask Atd or run a command right beside your selection, and choose where its answer goes.',
      zh: '工具栏就在选区旁，提问或运行命令，还能选好回答放到哪里。',
    },
    image: {
      src: mediaUrl('/cases/ui/selection-toolbar.png'),
      alt: {
        en: 'Atd selection toolbar above highlighted text, with Fix grammar’s options open: show in the conversation, replace the selected text, insert after it, insert at the cursor or copy.',
        zh: '文字选区上方的 Atd 工具栏，「修正语法」的选项已展开：在对话中显示、替换选中文字、插入到选区后、插入到光标处或复制。',
      },
    },
    layers: caseLayers['selection-toolbar'],
  },
  {
    id: 'write-back',
    label: { en: 'Write-back', zh: '写回原处' },
    title: { en: 'The answer lands where you asked.', zh: '回答，直接写回原处。' },
    description: {
      en: 'Run a command from its shortcut, and the result replaces your selection right where it is.',
      zh: '用快捷键运行命令，结果直接替换选中的文字，不用切换窗口。',
    },
    image: {
      src: mediaUrl('/cases/ui/write-back.png'),
      alt: {
        en: 'A rough draft line rewritten in place by a command, with the command island at the bottom of the screen showing Written.',
        zh: '一行潦草的草稿被命令原地改写，屏幕底部的命令灵动岛显示“已写入”。',
      },
    },
    layers: caseLayers['write-back'],
  },
  {
    id: 'mini-panel',
    label: { en: 'Mini Panel', zh: 'Mini Panel' },
    title: { en: 'Keep ongoing work in sight.', zh: '进行中的任务，都在眼前。' },
    description: {
      en: 'Follow task progress, respond to requests and return to a conversation from the edge of your screen.',
      zh: '在屏幕边缘查看任务进度、处理确认请求，随时回到对话。',
    },
    image: {
      src: mediaUrl('/cases/ui/mini-panel.png'),
      alt: {
        en: 'Mini Panel and Active tasks at the right edge of the desktop, showing two running tasks and a request to approve writing release-notes.md.',
        zh: '桌面右侧的迷你面板和任务动态，显示两个进行中的任务，以及写入 release-notes.md 的待确认请求。',
      },
    },
    layers: caseLayers['mini-panel'],
  },
  {
    id: 'screenshot',
    label: { en: 'Screenshot', zh: '截图工具' },
    title: { en: 'Show exactly what you mean.', zh: '框出重点，说明更直观。' },
    description: {
      en: 'Capture an area and add arrows, text, step numbers or mosaic before bringing it into a task.',
      zh: '框选画面，用箭头、文字、序号和马赛克做好标注，再把截图带进任务。',
    },
    image: {
      src: mediaUrl('/cases/ui/screenshot.png'),
      alt: {
        en: 'Screenshot selection with resize handles, numbered annotations, arrows and mosaic, plus the capture toolbar and color controls.',
        zh: '截图选区内的箭头、序号与马赛克标注，下方显示截图工具栏和颜色、线宽控制。',
      },
    },
    layers: caseLayers['screenshot'],
  },
  {
    id: 'main-panel',
    label: { en: 'Main panel', zh: '主面板' },
    title: { en: 'One place to begin.', zh: '想到什么，从这里开始。' },
    description: {
      en: 'Start a task, add context, and choose your model and permissions in a floating panel.',
      zh: '在浮动面板里输入任务、添加上下文，选择模型与权限，随时开始。',
    },
    image: {
      src: mediaUrl('/cases/ui/main-panel.png'),
      alt: {
        en: 'Atd new-task panel with its header, history and settings actions, composer, permissions and model selector.',
        zh: 'Atd 新任务主面板，包含顶部历史和设置入口、输入框、权限与模型选择。',
      },
    },
    layers: caseLayers['main-panel'],
  },
  {
    id: 'chat',
    label: { en: 'Conversation', zh: '聊天页' },
    title: { en: 'Keep the conversation moving.', zh: '接着追问，把事情做完整。' },
    description: {
      en: 'Read the result, follow the tool activity, and keep working in the same conversation.',
      zh: '查看回答与工具执行过程，在同一个对话中补充要求、继续追问。',
    },
    image: {
      src: mediaUrl('/cases/ui/chat.png'),
      alt: {
        en: 'A weekly recap conversation showing a follow-up request, tool activity, response actions and the composer.',
        zh: '周报对话中的追问、工具执行状态、回答操作和底部输入框。',
      },
    },
    layers: caseLayers['chat'],
  },
  {
    id: 'settings',
    label: { en: 'Settings', zh: '设置页' },
    title: { en: 'Choose how you connect.', zh: '选择适合你的连接方式。' },
    description: {
      en: 'Connect with a ChatGPT plan or API credentials, and control background use.',
      zh: '连接 ChatGPT 订阅或 API，先确认数据使用范围，再选择是否允许后台调用。',
    },
    image: {
      src: mediaUrl('/cases/ui/settings.png'),
      alt: {
        en: 'Connect OpenAI in Atd settings, with ChatGPT plan and API tabs, a connection name, data and privacy consent, background use controls and a sign-in action.',
        zh: 'Atd 设置中的 OpenAI 连接页，包含 ChatGPT 订阅与 API 选项、连接名称、数据与隐私同意、后台调用控制和登录操作。',
      },
    },
    layers: caseLayers['settings'],
  },
  {
    id: 'apps',
    label: { en: 'Apps', zh: '应用' },
    title: { en: 'Turn an idea into an app of your own.', zh: '把一个想法，变成自己的应用。' },
    description: {
      en: 'Create a small app with Atd, open it from My apps, and keep refining it in conversation.',
      zh: '让 Atd 帮你创建小应用，从「我的应用」打开使用，再通过对话继续完善。',
    },
    image: {
      src: mediaUrl('/cases/ui/apps.png'),
      alt: {
        en: 'My apps in Atd alongside a Notes app, showing the app launcher and a complete standalone application window.',
        zh: '同一桌面上的「我的应用」列表与 Notes 笔记应用，展示应用入口和独立应用窗口。',
      },
    },
    layers: caseLayers['apps'],
  },
  {
    id: 'automations',
    label: { en: 'Automations', zh: '自动化' },
    title: { en: 'Work that starts on its own.', zh: '让工作自己开始。' },
    description: {
      en: 'While Atd is running, start tasks on a schedule, when files change or your Mac is idle. Computer actions need separate authorization.',
      zh: 'Atd 运行时，按计划、文件变化或 Mac 空闲自动开始任务。操作网站与应用需单独授权。',
    },
    image: {
      src: mediaUrl('/cases/ui/automations.png'),
      alt: {
        en: 'Automations settings showing scheduled tasks, a folder-triggered workflow, memory consolidation, run status and pause controls.',
        zh: '自动化设置窗口，展示定时任务、文件夹触发、空闲时整理记忆、运行状态和暂停控制。',
      },
    },
    layers: caseLayers['automations'],
  },
] as const satisfies readonly Case[];
