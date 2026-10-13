import type { Lang } from '../../../copy.ts';
import type { Shape } from '../strings.ts';

/**
 * The settings window's copy, as the renderer ships it (`apps/desktop/src/i18n/locales/{en,zh-CN}`):
 * the sidebar's search field and sections (`settings.json`, in `settings-sections.ts` order), the
 * Commands list and editor (`commands.json`), the effort levels (`providers.json`
 * `thinkingLevels`) and the ChatGPT sign-in (`providers.json` `chatgpt`, `login`, `form`).
 * Part of `strings[lang].settings`, so the fonts load it with the rest of the product's copy.
 */
const en = {
  search: 'Search settings…',
  sections: {
    general: 'General',
    providers: 'Models',
    permissions: 'Permissions',
    commands: 'Commands',
    automations: 'Automations',
    memory: 'Memory',
    apps: 'Apps',
    extensions: 'Extensions',
  },
  commands: {
    title: 'Commands',
    description: 'Reusable instructions for the things you do often.',
    searchPlaceholder: 'Search commands…',
    new: 'New command',
    personal: 'Personal',
    setShortcut: 'Set shortcut',
    run: 'Run',
    reorderHint:
      'Press and hold a command to drag it into place, or move the focused one with ⌥↑ and ⌥↓.',
    typing: 'Typing effect',
  },
  /** The command editor's run settings: the Effort select and its hint. */
  run: {
    title: 'Run settings',
    description: 'The model, effort, memory and tools each run may use.',
    effort: 'Effort',
    effortHint:
      'How much the model reasons before it answers, whichever model runs the command. Lower is faster and cheaper. Each run adjusts the level to what its model supports.',
    effortInherit: 'Use connection default',
    levels: {
      off: 'Off',
      minimal: 'Minimal',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      xhigh: 'Extra high',
      max: 'Max',
    },
  },
  /** The command editor's Result group (`commands.json` `output`). */
  output: {
    title: 'Result',
    description: 'What happens with the answer when a run finishes.',
    action: 'When the answer is ready',
    savedTitle: '{{title}} (default)',
  },
  /** Signing in with ChatGPT, and the first success's dialog. */
  chatgpt: {
    continue: 'Continue with ChatGPT',
    signingIn: 'Signing in…',
    signInNote:
      'Sign in to continue in your browser. Your account credentials stay on this device.',
    cancel: 'Cancel',
    welcomeTitle: 'You’re using your ChatGPT plan',
    welcomeDescription:
      'Atd will use your ChatGPT plan for this connection. Manage usage and access in ChatGPT settings.',
    gotIt: 'Got it',
    usingPlan: 'Using ChatGPT plan',
    manageUsage: 'Manage usage',
    connectedTitle: 'ChatGPT is connected',
  },
};

export type SettingsStrings = Shape<typeof en>;

const zh: SettingsStrings = {
  search: '搜索设置…',
  sections: {
    general: '通用',
    providers: '模型',
    permissions: '权限',
    commands: '命令',
    automations: '自动化',
    memory: '记忆',
    apps: '应用',
    extensions: '扩展',
  },
  commands: {
    title: '命令',
    description: '把常用操作保存为可复用的命令。',
    searchPlaceholder: '搜索命令…',
    new: '新建命令',
    personal: '个人',
    setShortcut: '设置快捷键',
    run: '运行',
    reorderHint: '长按命令即可拖动排序，也可以用 ⌥↑ / ⌥↓ 移动当前聚焦的命令。',
    typing: '打字效果',
  },
  run: {
    title: '运行设置',
    description: '每次运行可以使用的模型、推理强度、记忆和工具。',
    effort: '推理强度',
    effortHint:
      '模型回答前推理的程度，无论由哪个模型运行此命令。强度越低，速度越快、成本越低。每次运行会按所用模型支持的强度进行调整。',
    effortInherit: '使用连接默认值',
    levels: {
      off: '关闭',
      minimal: '极简',
      low: '低',
      medium: '中',
      high: '高',
      xhigh: '极高',
      max: '最高',
    },
  },
  output: {
    title: '结果',
    description: '运行结束时如何处理回答。',
    action: '回答完成后',
    savedTitle: '{{title}}（默认）',
  },
  chatgpt: {
    continue: '继续使用 ChatGPT',
    signingIn: '正在登录…',
    signInNote: '点击登录后，在浏览器中完成授权。账号凭据保存在本设备。',
    cancel: '取消',
    welcomeTitle: '你正在使用 ChatGPT 订阅',
    welcomeDescription:
      '此连接将使用你的 ChatGPT 订阅。你可以在 ChatGPT 设置中管理用量和访问权限。',
    gotIt: '知道了',
    usingPlan: '正在使用 ChatGPT 订阅',
    manageUsage: '管理用量',
    connectedTitle: 'ChatGPT 已连接',
  },
};

export const settingsStrings: Record<Lang, SettingsStrings> = { en, zh };

/** The sections in navigation order. */
export type SettingsSectionId = keyof SettingsStrings['sections'];

/**
 * The window's own chrome (the search field and the sections), as the release draft's
 * `SETTINGS_CHROME` had it; `strings[lang].settings` holds the same and more.
 */
export const SETTINGS_CHROME = settingsStrings;

/** The effort levels after "Use connection default", in the contract's order. */
export const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * The Effort select's items as the command editor lists them: "Use connection default", then
 * Off … Max. Index 0 is the inherit item; level `n` is at `EFFORT_LEVELS.indexOf(n) + 1`.
 */
export function effortItems(lang: Lang): string[] {
  const run = settingsStrings[lang].run;
  return [run.effortInherit, ...EFFORT_LEVELS.map((level) => run.levels[level])];
}
