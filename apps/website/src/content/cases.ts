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
  image: CaseImage;
}

/** Figma scenes share the canonical desktop and a 1440 × 900 canvas. Source nodes and update instructions live in public/cases/README.md. */
export const cases = [
  {
    id: 'selection-toolbar',
    label: { en: 'Selection toolbar', zh: '选区工具栏' },
    title: { en: 'Start with the words in front of you.', zh: '选中文字，就能接着做。' },
    description: {
      en: 'Ask Atd, translate, summarize or explain, right beside your selection.',
      zh: '工具栏就在选区旁，提问、翻译、总结或解释，顺手完成。',
    },
    image: {
      src: mediaUrl('/cases/ui/selection-toolbar.png'),
      alt: {
        en: 'Atd selection toolbar above highlighted text, with Ask Atd, Translate, Summarize and Explain actions.',
        zh: '文字选区上方的 Atd 工具栏，包含提问、翻译、总结和解释操作。',
      },
    },
  },
  {
    id: 'mini-panel',
    label: { en: 'Mini Panel', zh: 'Mini Panel' },
    title: { en: 'A little space. A quick way in.', zh: '屏幕边缘，留一个入口。' },
    description: {
      en: 'Open a task, take a screenshot or pick a saved command from the edge of your screen.',
      zh: '在屏幕边缘展开迷你面板，新建任务、截图，或运行常用命令。',
    },
    image: {
      src: mediaUrl('/cases/ui/mini-panel.png'),
      alt: {
        en: 'Expanded Mini Panel at the right edge of the desktop, with its saved-command menu open.',
        zh: '桌面右侧展开的迷你面板，以及打开的常用命令菜单。',
      },
    },
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
  },
  {
    id: 'settings',
    label: { en: 'Settings', zh: '设置页' },
    title: { en: 'Make room for your way of working.', zh: '按你的习惯，安排好一切。' },
    description: {
      en: 'Connect your models and manage permissions, commands, automations, memory and extensions.',
      zh: '接入模型，管理权限、命令、自动化、记忆与扩展，让 Atd 配合你的工作方式。',
    },
    image: {
      src: mediaUrl('/cases/ui/settings.png'),
      alt: {
        en: 'Atd settings with the navigation sidebar and model providers, including ChatGPT, Anthropic and LM Studio.',
        zh: 'Atd 设置窗口，左侧为功能导航，右侧为 ChatGPT、Anthropic 和 LM Studio 模型配置。',
      },
    },
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
  },
  {
    id: 'automations',
    label: { en: 'Automations', zh: '自动化' },
    title: { en: 'Work that starts on its own.', zh: '让工作自己开始。' },
    description: {
      en: 'Start tasks on a schedule, when files change or when your Mac is idle. Check their status and results in one place.',
      zh: '按计划、文件变化或 Mac 空闲时自动开始，统一查看任务状态与结果。',
    },
    image: {
      src: mediaUrl('/cases/ui/automations.png'),
      alt: {
        en: 'Automations settings showing scheduled tasks, a folder-triggered workflow, memory consolidation, run status and pause controls.',
        zh: '自动化设置窗口，展示定时任务、文件夹触发、空闲时整理记忆、运行状态和暂停控制。',
      },
    },
  },
] as const satisfies readonly Case[];
