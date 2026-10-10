import type { Lang } from '../../copy.ts';

/**
 * The product's own interface chrome, per language, as the app ships it: renderer copy from
 * `apps/desktop/src/i18n/locales/{en,zh-CN}`, native copy from `apps/macos/App/Localizable.xcstrings`.
 * The two languages keep identical keys. Placeholders are `{{name}}`, filled by `fill`.
 *
 * Content a scene shows inside the interface (prompts, answers, file and app names) is the scene's
 * own `content.ts`; components take it as props.
 */
const en = {
  panel: {
    newTask: 'New task',
    newChat: 'New chat',
    tasks: 'Tasks',
    settings: 'Settings',
    welcomeTitle: 'What can I help with?',
    welcomeSubtitle: 'Ask anything, or start with a command.',
  },
  composer: {
    placeholder: 'Ask anything…',
    followUp: 'Ask a follow-up…',
    send: 'Send task',
    stop: 'Stop task',
    attach: 'Attach context',
    drop: 'Drop to add as context',
  },
  tier: { manual: 'Manual approval', auto: 'Auto approval', always: 'Always allow' },
  effort: { low: 'Low', medium: 'Medium', high: 'High' },
  progress: {
    step: 'Step {{current}} / {{total}}',
    running: '{{count}} running',
    waitingApproval: 'Waiting for your approval',
  },
  todos: { title: 'Todos', progress: '{{completed}} of {{total}} done' },
  subagents: { title: 'Subagents', running: 'Running', completed: 'Completed' },
  thinking: { live: 'Thinking', done: 'Thought {{elapsed}}' },
  approval: {
    allowOnce: 'Allow once',
    allowTool: 'Allow this tool',
    decline: 'Decline',
    alwaysAllow: 'Always allow “{{entry}}”',
    deny: 'Deny',
    scope: {
      editOutside: "Edit a file outside this task's folder",
      writeOutside: "Create a file outside this task's folder",
      readOutside: "Read a file outside this task's folder",
      bash: 'Run a terminal command',
      automation: 'Save, delete or run an automation',
    },
  },
  files: { available: 'Available', open: 'Open' },
  app: {
    step: 'Build app',
    building: 'Type-checking and building version {{version}}…',
    open: 'Open',
    history: 'Version history',
    version: 'v{{version}}',
  },
  memory: { remembered: 'Remembered', save: 'Save memory' },
  created: { command: 'Command', skill: 'Skill', automation: 'Automation' },
  selection: { ask: 'Ask Atd', more: 'More' },
  capture: { undo: 'Undo', redo: 'Redo', cancel: 'Cancel', copy: 'Copy', done: 'Done' },
  notice: { app: 'Atd', now: 'now', delivered: 'Finished — open to see the result.' },
  /** Monday to Sunday, space-separated, for the habit tracker the film's agent builds. */
  week: { narrow: 'M T W T F S S', short: 'Mon Tue Wed Thu Fri Sat Sun' },
};

/** The shape every language fills: the English keys, each a string. */
type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type ProductStrings = Shape<typeof en>;

const zh: ProductStrings = {
  panel: {
    newTask: '新建任务',
    newChat: '新建对话',
    tasks: '任务',
    settings: '设置',
    welcomeTitle: '有什么可以帮你？',
    welcomeSubtitle: '直接提问，或用命令开始。',
  },
  composer: {
    placeholder: '输入任何内容…',
    followUp: '继续追问…',
    send: '发送任务',
    stop: '停止任务',
    attach: '附加上下文',
    drop: '松开以添加为上下文',
  },
  tier: { manual: '手动批准', auto: '自动批准', always: '始终允许' },
  effort: { low: '低', medium: '中', high: '高' },
  progress: {
    step: '第 {{current}} / {{total}} 步',
    running: '{{count}} 个运行中',
    waitingApproval: '等待你的批准',
  },
  todos: { title: '待办', progress: '已完成 {{completed}}/{{total}}' },
  subagents: { title: '子智能体', running: '运行中', completed: '已完成' },
  thinking: { live: '思考中', done: '已思考 {{elapsed}}' },
  approval: {
    allowOnce: '允许一次',
    allowTool: '允许此工具',
    decline: '拒绝',
    alwaysAllow: '始终允许“{{entry}}”',
    deny: '拒绝',
    scope: {
      editOutside: '编辑此任务文件夹外的文件',
      writeOutside: '在此任务文件夹外创建文件',
      readOutside: '读取此任务文件夹外的文件',
      bash: '运行终端命令',
      automation: '保存、删除或运行自动化',
    },
  },
  files: { available: '可用', open: '打开' },
  app: {
    step: '构建应用',
    building: '正在类型检查并构建版本 {{version}}…',
    open: '打开',
    history: '版本历史',
    version: 'v{{version}}',
  },
  memory: { remembered: '已记住', save: '保存记忆' },
  created: { command: '命令', skill: '技能', automation: '自动化' },
  selection: { ask: '问 Atd', more: '更多' },
  capture: { undo: '撤销', redo: '重做', cancel: '取消', copy: '复制', done: '完成' },
  notice: { app: 'Atd', now: '现在', delivered: '已完成，打开即可查看结果。' },
  week: { narrow: '一 二 三 四 五 六 日', short: '周一 周二 周三 周四 周五 周六 周日' },
};

export const strings: Record<Lang, ProductStrings> = { en, zh };

/** A string's `{{name}}` placeholders filled from `values`. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
