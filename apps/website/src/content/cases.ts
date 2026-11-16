import { mediaUrl } from './media';
import type { Lang, Localized } from '../i18n/lang';

/** The showcase's groups, in order: what a visitor does with Atd. */
export const caseGroups = [
  { id: 'in-place', name: { en: 'In place', zh: '就地处理' } },
  { id: 'panel', name: { en: 'Panel and conversation', zh: '面板与对话' } },
  { id: 'extend', name: { en: 'Apps and connections', zh: '扩展与连接' } },
] as const satisfies readonly { id: string; name: Localized<string> }[];

type CaseGroupId = (typeof caseGroups)[number]['id'];

interface Case {
  id: string;
  /** The case's group; the showcase lists cases in group order, so a group's cases stay together. */
  group: CaseGroupId;
  label: Localized<string>;
  title: Localized<string>;
  description: Localized<string>;
  /** The caption under the image: a lead-in and the part it leads to, which reads brighter. */
  caption: Localized<readonly [lead: string, accent: string]>;
  /** What the image shows, for assistive technology. */
  alt: Localized<string>;
}

/** One stationary backdrop shared by the transparent foreground compositions. */
export const caseBackdrop = mediaUrl('/cases/showcase/background.webp');

/** Transparent foregrounds exported from the canonical Figma Website page. */
export function caseImage(id: string, lang: Lang): string {
  return mediaUrl(`/cases/showcase/${lang}/${id}.webp`);
}

/** Each case describes the visible state in its localized illustration. */
export const cases = [
  {
    id: 'selection-toolbar',
    group: 'in-place',
    label: { en: 'Selection toolbar', zh: '选区工具栏' },
    title: { en: 'Start with the words in front of you.', zh: '选中文字，就能接着做。' },
    description: {
      en: 'Ask Atd or run a command right beside your selection, and change its options on the way.',
      zh: '工具栏就在选区旁，提问或运行命令，按钮旁还能随手改选项。',
    },
    caption: {
      en: ['Choose where the answer goes: ', 'right back into your text.'],
      zh: ['答案放在哪里，', '就在按钮旁选择。'],
    },
    alt: {
      en: 'Selected text with the floating toolbar and Fix grammar’s answer destinations, including replace, insert and copy.',
      zh: '选中文字旁显示浮动工具栏，“润色文字”的输出选项包含替换、插入和复制。',
    },
  },
  {
    id: 'write-back',
    group: 'in-place',
    label: { en: 'Review card', zh: '结果卡片' },
    title: { en: 'Review it. Make it yours.', zh: '先看结果，再决定如何使用。' },
    description: {
      en: 'Review a command’s answer beside the original, adjust its wording, then copy, insert or replace.',
      zh: '在原文旁查看命令结果，继续调整表达，再选择复制、插入或替换。',
    },
    caption: {
      en: ['Keep the original in sight, ', 'and put the answer where it belongs.'],
      zh: ['原文就在眼前，', '满意后再用上结果。'],
    },
    alt: {
      en: 'A selected draft sits above its Fix grammar review card, with the original, revised answer, adjustment field, and copy, insert and replace actions.',
      zh: '选中的草稿下方显示“润色文字”结果卡，包含原文、修改结果、调整输入框，以及复制、插入和替换操作。',
    },
  },
  {
    id: 'screenshot',
    group: 'in-place',
    label: { en: 'Screenshot', zh: '截图工具' },
    title: { en: 'Show exactly what you mean.', zh: '框出重点，说明更直观。' },
    description: {
      en: 'Capture an area and add arrows, text, step numbers or mosaic before bringing it into a task.',
      zh: '框选画面，用箭头、文字、序号和马赛克做好标注，再把截图带进任务。',
    },
    caption: {
      en: ['Mark what matters ', 'and say it at a glance.'],
      zh: ['框出重点，', '说明更直观。'],
    },
    alt: {
      en: 'A selected report area with arrows, three numbered steps, a text note and redacted account details, above the annotation toolbar and screenshot commands.',
      zh: '截图框选报表，带有箭头、三个序号、文字说明和遮盖账户信息的马赛克，下方显示标注工具栏与截图命令。',
    },
  },
  {
    id: 'main-panel',
    group: 'panel',
    label: { en: 'Main panel', zh: '主面板' },
    title: { en: 'One place to begin.', zh: '想到什么，从这里开始。' },
    description: {
      en: 'Call up the floating panel with ⌘⇧Space, drop in files, mention an earlier conversation and ask.',
      zh: '用 ⌘⇧Space 唤起浮动面板，拖入文件、提及以前的对话，直接提问。',
    },
    caption: {
      en: ['A question or a command, ', 'one place to begin.'],
      zh: ['提问或运行命令，', '都从这里开始。'],
    },
    alt: {
      en: 'The current floating task panel with quick commands, All commands, Create app, My apps and the composer.',
      zh: '浮动任务面板展示快捷命令、全部命令、创建应用、我的应用，以及底部输入区。',
    },
  },
  {
    id: 'chat',
    group: 'panel',
    label: { en: 'Conversation', zh: '聊天页' },
    title: { en: 'Keep the thread. Keep going.', zh: '接着上一句，继续往下做。' },
    description: {
      en: 'Read the answers and tool activity, add a follow-up, and keep working in the same conversation.',
      zh: '查看回答和工具调用，随时继续追问，在同一个对话里把事情做完。',
    },
    caption: {
      en: ['The answer stays in context, ', 'ready for your next question.'],
      zh: ['上下文接得上，', '下一句继续问。'],
    },
    alt: {
      en: 'A weekly recap conversation shows two answers, a follow-up request, completed turn headers, tool activity and the composer.',
      zh: '每周总结对话展示前后两次回答、追问、完成的回合标题、工具调用和底部输入区。',
    },
  },
  {
    id: 'mini-panel',
    group: 'panel',
    label: { en: 'Mini Panel', zh: 'Mini Panel' },
    title: { en: 'Keep ongoing work in sight.', zh: '进行中的任务，都在眼前。' },
    description: {
      en: 'Follow task progress, respond to requests and return to a conversation from the edge of your screen.',
      zh: '在屏幕边缘查看任务进度、处理确认请求，随时回到对话。',
    },
    caption: {
      en: ['Every task you hand off, ', 'followed up right here.'],
      zh: ['交出去的任务，', '都在这里跟进。'],
    },
    alt: {
      en: 'The Mini Panel’s active tasks popover shows one file-write approval request and two ongoing tasks beside the screen-edge rail.',
      zh: '屏幕边缘的迷你面板展开活跃任务，展示一个等待批准的文件写入请求和两个进行中的任务。',
    },
  },
  {
    id: 'computer-use',
    group: 'extend',
    label: { en: 'Computer use', zh: '电脑操作' },
    title: { en: 'Let Atd do the clicking.', zh: '网页和应用，交给它来操作。' },
    description: {
      en: 'With your permission, Atd works your Mac apps with a pointer of its own, then checks what it did.',
      zh: '经你授权，Atd 用自己的指针操作 Mac 应用，做完还会核实结果。',
    },
    caption: {
      en: ['It works your apps ', 'and checks the result.'],
      zh: ['替你操作应用，', '做完还核实。'],
    },
    alt: {
      en: 'Atd’s live pointer fills the amount and description of an expense form, with its orange Filling in status beside the active field.',
      zh: 'Atd 的实时指针填写报销表的金额与描述，当前字段旁显示橙色“填写中”状态。',
    },
  },
  {
    id: 'apps',
    group: 'extend',
    label: { en: 'Apps', zh: '应用' },
    title: { en: 'Turn an idea into an app of your own.', zh: '把一个想法，变成自己的应用。' },
    description: {
      en: 'Describe a small app, and Atd builds and publishes it; open it any time from My apps.',
      zh: '说出想要的小应用，Atd 帮你构建并发布，随时从「我的应用」打开。',
    },
    caption: {
      en: ['Turn an idea ', 'into your own app.'],
      zh: ['把一个想法，', '变成自己的应用。'],
    },
    alt: {
      en: 'My apps lists personal tools beside an open Notes app with an input and three saved notes.',
      zh: '“我的应用”列出个人工具，旁边打开的笔记应用包含输入框和三条已保存笔记。',
    },
  },
  {
    id: 'automations',
    group: 'extend',
    label: { en: 'Automations', zh: '自动化' },
    title: { en: 'Work that starts on its own.', zh: '让工作自己开始。' },
    description: {
      en: 'Run prompts and commands on a schedule or when files change, while Atd is running.',
      zh: '在 Atd 运行时，让提示词和命令按计划，或在文件变化时自动执行。',
    },
    caption: {
      en: ['A schedule or a file change, ', 'and the work begins.'],
      zh: ['到了时间、文件有变化，', '工作自动开始。'],
    },
    alt: {
      en: 'The automations list shows scheduled memory consolidation, a folder-triggered invoice filer, a weekday inbox brief and a paused release watcher.',
      zh: '自动化列表展示定时整理记忆、文件夹触发的发票归档、工作日邮件摘要，以及已暂停的更新说明跟踪。',
    },
  },
  {
    id: 'settings',
    group: 'extend',
    label: { en: 'Settings', zh: '设置页' },
    title: { en: 'Choose how you connect.', zh: '选择适合你的连接方式。' },
    description: {
      en: 'Connect with a ChatGPT plan or API credentials, and control background use.',
      zh: '连接 ChatGPT 订阅或 API，先确认数据使用范围，再选择是否允许后台调用。',
    },
    caption: {
      en: ['Agree to connect, ', 'then sign in with your plan.'],
      zh: ['先同意连接，', '再用订阅登录。'],
    },
    alt: {
      en: 'The OpenAI connection editor shows ChatGPT plan and API options, data and privacy consent, background-use control and the sign-in action.',
      zh: 'OpenAI 连接设置展示 ChatGPT 订阅和 API 选项、数据与隐私同意开关、后台调用控制和登录操作。',
    },
  },
] as const satisfies readonly Case[];
