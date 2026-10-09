/**
 * Everything the film says, per language. The lines are the website's approved copy
 * (apps/website/src/sections and content/cases.ts), so the film and the site speak alike; the LED
 * display's words stay in English in both cuts because they spell out the name.
 */
import type { CaseId } from './timeline.ts';

export const LANGS = ['en', 'zh'] as const;
export type Lang = (typeof LANGS)[number];

/** The `lang` attribute for a cut, which also lets the stylesheets set Chinese differently. */
export function htmlLang(lang: Lang): string {
  return lang === 'zh' ? 'zh-CN' : 'en';
}

interface CaseCopy {
  /** The small dot-matrix readout above the headline. */
  label: string;
  title: string;
  body: string;
}

interface FilmCopy {
  tagline: string;
  cases: Record<CaseId, CaseCopy>;
  features: {
    title: string;
    items: { title: string; body: string }[];
  };
  privacy: { title: string; lede: string; never: string[] };
  outro: { title: string; lede: string; cta: string; url: string; specs: string };
}

export const copy: Record<Lang, FilmCopy> = {
  en: {
    tagline: 'A quiet agent for your Mac.',
    cases: {
      summon: {
        label: 'Shortcut',
        title: 'Always one shortcut away.',
        body: 'Atd rises in the corner of any screen. Press again to hide it; your draft stays.',
      },
      chat: {
        label: 'Conversation',
        title: 'Keep the conversation moving.',
        body: 'Read the result, follow the tool activity, and keep working in the same conversation.',
      },
      selection: {
        label: 'Selection toolbar',
        title: 'Start with the words in front of you.',
        body: 'Ask Atd, translate, summarize or explain, right beside your selection.',
      },
      screenshot: {
        label: 'Screenshot',
        title: 'Show exactly what you mean.',
        body: 'Capture an area and add arrows, text, step numbers or mosaic before bringing it into a task.',
      },
      mini: {
        label: 'Mini Panel',
        title: 'A little space. A quick way in.',
        body: 'Open a task, take a screenshot or pick a saved command from the edge of your screen.',
      },
      models: {
        label: 'Settings',
        title: 'Make room for your way of working.',
        body: 'Connect your models and manage permissions, commands, automations, memory and extensions.',
      },
      apps: {
        label: 'Apps',
        title: 'Turn an idea into an app of your own.',
        body: 'Create a small app with Atd, open it from My apps, and keep refining it in conversation.',
      },
      automations: {
        label: 'Automations',
        title: 'Work that starts on its own.',
        body: 'Start tasks on a schedule, when files change or when your Mac is idle.',
      },
    },
    features: {
      title: 'Your setup, your rules, your Mac.',
      items: [
        { title: 'Models', body: 'Use the providers you have, cloud or local.' },
        { title: 'Extensions', body: 'Skills, subagents, MCP servers and / commands.' },
        { title: 'Memory', body: 'It learns how you work. You review what it keeps.' },
        { title: 'Permissions', body: 'You decide what it may do without asking.' },
        { title: 'Runs locally', body: 'No account, and no Atd server in between.' },
      ],
    },
    privacy: {
      title: 'Local by design.',
      lede: 'What Atd keeps stays on your Mac. A task leaves only for the model you choose.',
      never: ['No account to create', 'No Atd server in between', 'No usage tracking'],
    },
    outro: {
      title: 'Ready when you are.',
      lede: 'Download Atd, press ⌘ ⇧ Space, and hand it your first task.',
      cta: 'Download for Mac',
      url: 'atd.best',
      specs: 'macOS 26+ · Apple silicon',
    },
  },
  zh: {
    tagline: '安静待命的 Mac 智能体。',
    cases: {
      summon: {
        label: '快捷键',
        title: '一个快捷键，随叫随到。',
        body: 'Atd 从屏幕一角升起。再按一次收起，草稿原样保留。',
      },
      chat: {
        label: '对话',
        title: '接着追问，把事情做完整。',
        body: '查看回答与工具执行过程，在同一个对话中补充要求、继续追问。',
      },
      selection: {
        label: '选区工具栏',
        title: '选中文字，就能接着做。',
        body: '工具栏就在选区旁，提问、翻译、总结或解释，顺手完成。',
      },
      screenshot: {
        label: '截图工具',
        title: '框出重点，说明更直观。',
        body: '框选画面，用箭头、文字、序号和马赛克做好标注，再把截图带进任务。',
      },
      mini: {
        label: 'Mini Panel',
        title: '屏幕边缘，留一个入口。',
        body: '在屏幕边缘展开迷你面板，新建任务、截图，或运行常用命令。',
      },
      models: {
        label: '设置',
        title: '按你的习惯，安排好一切。',
        body: '接入模型，管理权限、命令、自动化、记忆与扩展，让 Atd 配合你的工作方式。',
      },
      apps: {
        label: '应用',
        title: '把一个想法，变成自己的应用。',
        body: '让 Atd 帮你创建小应用，从「我的应用」打开使用，再通过对话继续完善。',
      },
      automations: {
        label: '自动化',
        title: '让工作自己开始。',
        body: '按计划、文件变化或 Mac 空闲时自动开始，统一查看任务状态与结果。',
      },
    },
    features: {
      title: '你的配置，你的规则，你的 Mac。',
      items: [
        { title: '模型', body: '接入在用的提供商，云端本机皆可。' },
        { title: '扩展', body: '技能、子代理、MCP 和 / 命令。' },
        { title: '记忆', body: '学习你的习惯，记住什么由你审核。' },
        { title: '权限', body: '无需询问能做多少，由你决定。' },
        { title: '本地运行', body: '无需账号，不经 Atd 服务器中转。' },
      ],
    },
    privacy: {
      title: '本地运行，设计使然。',
      lede: 'Atd 保存的一切都留在你的 Mac 上。任务只发往你选择的模型。',
      never: ['无需注册账号', '没有 Atd 服务器中转', '不收集使用数据'],
    },
    outro: {
      title: '随时待命。',
      lede: '下载 Atd，按下 ⌘ ⇧ Space，交给它第一个任务。',
      cta: '下载 Mac 版',
      url: 'atd.best',
      specs: 'macOS 26+ · Apple 芯片',
    },
  },
};

/** Every string a language shows, so its font subsets can load before the first frame. */
export function allText(lang: Lang): string {
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(copy[lang]);
  return strings.join('');
}
