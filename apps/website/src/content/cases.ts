import { mediaUrl } from './media';
import type { Lang, Localized } from '../i18n/lang';

/** The showcase's groups, in order: what a visitor does with Atd. */
export const caseGroups = [
  { id: 'in-place', name: { en: 'In place', zh: '就地处理' } },
  { id: 'panel', name: { en: 'Panel and conversation', zh: '面板与对话' } },
  { id: 'extend', name: { en: 'Apps and connections', zh: '扩展与连接' } },
] as const satisfies readonly { id: string; name: Localized<string> }[];

type CaseGroupId = (typeof caseGroups)[number]['id'];

/** A case's clip in one language: the silent, looping video and the still shown in its place. */
export interface CaseClip {
  video: string;
  poster: string;
}

interface Case {
  id: string;
  /** The case's group; the showcase lists cases in group order, so a group's cases stay together. */
  group: CaseGroupId;
  label: Localized<string>;
  title: Localized<string>;
  description: Localized<string>;
  /** The caption under the clip: a lead-in and the part it leads to, which reads brighter. */
  caption: Localized<readonly [lead: string, accent: string]>;
  /** What the clip shows, for assistive technology. */
  alt: Localized<string>;
}

/** Each case's clip, rendered by the films repository in both languages (public/cases/README.md). */
export function caseClip(id: string, lang: Lang): CaseClip {
  return {
    video: mediaUrl(`/cases/clips/${lang}/${id}.mp4`),
    poster: mediaUrl(`/cases/clips/${lang}/${id}.jpg`),
  };
}

/** The cases, each a clip cut from the tour films (or the settings film) in the films repository. */
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
      en: ['Options beside the button: ', 'switch to Japanese.'],
      zh: ['按钮旁的选项，', '随手换成日语。'],
    },
    alt: {
      en: 'A reply is selected in Messages; Translate’s options set the target language to Japanese, and the reply is replaced in Japanese.',
      zh: '在“信息”中选中一条回复，在“翻译”的选项里把目标语言换成日语，回复随即被替换成日语。',
    },
  },
  {
    id: 'write-back',
    group: 'in-place',
    label: { en: 'Compose card', zh: '输入卡片' },
    title: { en: 'Nothing selected? Just type.', zh: '没选中文字，也能直接写。' },
    description: {
      en: 'Press a command’s shortcut with nothing selected, type in the card that opens, and the result is written at the caret.',
      zh: '没选中文字时按下命令的快捷键，在弹出的卡片里输入，结果直接写到光标处。',
    },
    caption: {
      en: ['Nothing selected? ', 'Type, and it writes at the caret.'],
      zh: ['没选中文字，', '输入后写到光标处。'],
    },
    alt: {
      en: 'In a new Mail message with nothing selected, a Translate shortcut opens the compose card; a line typed in English is run, and its Spanish translation is written at the caret.',
      zh: '在新邮件里不选中任何文字，按下“翻译”的快捷键打开输入卡片，输入一句中文后运行，英文译文直接写到光标处。',
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
      en: 'From the Mini Panel, a screenshot frames part of meeting notes, then adds an arrow, a note, two step numbers and a mosaic, and the image goes into a new task.',
      zh: '从迷你面板截图，框选会议纪要的一部分，加上箭头、文字、两个序号和马赛克，再把截图放进新任务。',
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
      en: ['Call it up anytime, ', 'and bring any file along.'],
      zh: ['随时唤起，', '什么文件都能带上。'],
    },
    alt: {
      en: 'The main panel opens with ⌘⇧Space; three files are dropped in as context, an earlier conversation is mentioned with @, and a request is typed.',
      zh: '按 ⌘⇧Space 打开主面板，拖入三个文件作为上下文，用 @ 提及以前的对话，再输入请求。',
    },
  },
  {
    id: 'chat',
    group: 'panel',
    label: { en: 'Conversation', zh: '聊天页' },
    title: { en: 'Watch the work, approve what matters.', zh: '过程看得见，关键操作先问你。' },
    description: {
      en: 'Follow the plan, todos and subagents as it works, and approve a risky step before it runs.',
      zh: '边做边看计划、待办和子智能体，有风险的操作先请你批准。',
    },
    caption: {
      en: ['A clear plan, ', 'and it asks before key steps.'],
      zh: ['计划清楚，', '关键操作先问你。'],
    },
    alt: {
      en: 'A sent request starts a run: the turn header counts its tools and subagents, the todo list and subagents open, and a file write waits for Allow once.',
      zh: '请求发出后开始运行：回合标题统计工具和子智能体，待办和子智能体依次展开，一次写入文件的操作等待“允许一次”。',
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
      en: 'The Mini Panel at the screen’s edge lights up; Active tasks lists a task that needs approval and one in progress, the request is allowed once, and both tasks end completed.',
      zh: '屏幕边缘的迷你面板亮起，“活跃任务”列出一个待确认和一个进行中的任务，允许一次后两个任务都已完成。',
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
      en: 'Atd’s live pointer finds a note in a notes app, clicks it, types a summary into it, clicks Done and checks the text it wrote.',
      zh: 'Atd 的实时指针在笔记应用里找到一条笔记，点开、输入摘要、点击完成，再核对写入的内容。',
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
      en: 'Create app starts a task for a weekly brief helper; Atd writes and builds it, its card appears, and it is listed in My apps.',
      zh: '用“创建应用”开始做一个周报助手，Atd 编写并构建，生成应用卡片，并出现在“我的应用”中。',
    },
  },
  {
    id: 'automations',
    group: 'extend',
    label: { en: 'Automations', zh: '自动化' },
    title: { en: 'Work that starts on its own.', zh: '让工作自己开始。' },
    description: {
      en: 'Turn a suggested next step into an automation, and it runs on its schedule while Atd is running.',
      zh: '把建议的下一步变成自动化，Atd 运行时按计划自动开始。',
    },
    caption: {
      en: ['The next step ', 'becomes an automation.'],
      zh: ['下一步，', '交给自动化。'],
    },
    alt: {
      en: 'Under a finished answer, a suggested next step opens Create automation for every Monday at 09:00, and a toast confirms it was created.',
      zh: '回答下方的“下一步”建议打开“创建自动化”，设为每周一 09:00，提示自动化已创建。',
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
      en: 'In Settings, Connect OpenAI on the ChatGPT plan: the consent switch is turned on, Sign in to ChatGPT is clicked, and a dialog confirms the plan is in use.',
      zh: '在设置中连接 OpenAI 的 ChatGPT 订阅：打开同意开关，点击登录 ChatGPT，对话框确认正在使用订阅。',
    },
  },
] as const satisfies readonly Case[];
