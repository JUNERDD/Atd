import type { Lang } from '../../../copy.ts';

/**
 * What the everything section's tiles show inside the product's interface, per language. Product
 * chrome is verbatim from the app: renderer locales (`apps/desktop/src/i18n/locales/<lng>/…`,
 * keys noted) or the product kit's `strings.ts`. Skill names and descriptions, MCP server ids,
 * provider and model names are runtime data and stay untranslated. Registered with the fonts
 * through `src/release/content.ts`; the narrative words come from `releaseCopy`.
 */
export interface EverythingContent {
  tasks: {
    prompt: string;
    thinking: string;
    todos: readonly string[];
    /** `tasks:activity.step.grep` / `.bash`. */
    grep: string;
    bash: string;
    /** `tasks:activity.step.write`. */
    write: string;
    grepDetail: string;
    grepLines: readonly string[];
    bashLines: readonly string[];
    files: string;
    result: string;
    size: string;
    bashDetail: string;
  };
  apps: {
    sentence: string;
    name: string;
    summary: string;
    week: string;
    habits: readonly string[];
  };
  automation: { name: string; schedule: string };
  memory: {
    text: string;
    /** `memory:memory.suggestions.title`, `.kinds.skill`, `.accept`, `.dismiss`, `.skillCreated`. */
    suggestions: string;
    newSkill: string;
    accept: string;
    dismiss: string;
    created: string;
    skill: string;
    skillTitle: string;
  };
  /** `settings:service.skillsTitle`, `settings:service.mcpTitle`. */
  skillsTitle: string;
  mcpTitle: string;
  skills: readonly { name: string; description: string }[];
  /** `panel:quickPanel.mcpState.*`. */
  mcpStates: { ready: string; connecting: string; signIn: string };
  mcp: readonly string[];
  subagents: { run: string; items: readonly { title: string; agent: string }[] };
  /** `settings:providers.overview.connectedProviders`, `providers:catalog.category.*`. */
  providers: {
    title: string;
    rows: readonly { name: string; category: string }[];
  };
  chips: { file: string; skill: string; memory: string };
  command: string;
  composer: { text: string; model: string; context: string };
  /** The file dragged onto the Mini Panel. */
  dragged: string;
  brands: readonly string[];
}

const SKILLS = [
  {
    name: 'create-app',
    description: 'Build a small personal desktop app inside Atd, or change one already built here',
  },
  {
    name: 'create-automation',
    description:
      "Create or change one of the user's automations, agent work this app starts by itself",
  },
  {
    name: 'create-command',
    description: 'Create or update a saved command for this agent, a reusable prompt the user runs',
  },
  {
    name: 'create-mcp',
    description: 'Add an MCP server to this agent or change one it already has',
  },
  { name: 'plan-mode', description: 'Plan before acting. Research the task folder read-only' },
] as const;

const MCP = ['github', 'filesystem', 'linear', 'notion', 'brave-search'] as const;

const BRANDS = [
  'Claude',
  'OpenAI',
  'Gemini',
  'Ollama',
  'DeepSeek',
  'Qwen',
  'Mistral',
  'xAI',
  'LM Studio',
  'OpenRouter',
  'Kimi',
  'vLLM',
] as const;

export const content = {
  en: {
    tasks: {
      prompt: 'Summarize the March invoices and flag anything unusual.',
      thinking: 'Finding the invoices first',
      todos: [
        'Find the March invoices',
        'Read each PDF',
        'Total by vendor',
        'Flag anything unusual',
        'Write the summary',
      ],
      grep: 'Search file contents',
      bash: 'Run command',
      write: 'Write file',
      grepDetail: 'invoice',
      grepLines: ['Invoices/2026-03-acme.pdf', 'Invoices/2026-03-globex.pdf'],
      bashLines: ['$ pdftotext -layout Invoices/*.pdf -', 'Globex           Total  $9,850.00'],
      files: '5 files',
      result: 'summary.md',
      size: '2 KB',
      bashDetail: 'pdftotext -layout',
    },
    apps: {
      sentence: 'Make me a habit tracker',
      name: 'Habit Tracker',
      summary: 'A week grid with a check per habit and day.',
      week: 'This week',
      habits: ['Run', 'Read 20 pages', 'No sugar'],
    },
    automation: { name: 'Nightly digest', schedule: 'Every day at 2:00' },
    memory: {
      text: 'prefers metric units',
      suggestions: 'Suggestions',
      newSkill: 'New skill',
      accept: 'Accept',
      dismiss: 'Dismiss',
      created: 'Created skill {{name}}.',
      skill: 'weekly-report',
      skillTitle: 'Write the weekly report from my notes',
    },
    skillsTitle: 'Skills',
    mcpTitle: 'MCP servers',
    skills: SKILLS,
    mcpStates: { ready: 'Ready', connecting: 'Connecting…', signIn: 'Needs sign-in' },
    mcp: MCP,
    subagents: {
      run: 'Invoke subagent',
      items: [
        { title: 'Read the March invoices', agent: 'reader' },
        { title: 'Compare with February', agent: 'analyst' },
        { title: 'Check the vendor contracts', agent: 'reviewer' },
      ],
    },
    providers: {
      title: 'Connected providers',
      rows: [
        { name: 'ChatGPT', category: 'Account login' },
        { name: 'Anthropic', category: 'API keys' },
        { name: 'Google Gemini', category: 'API keys' },
        { name: 'OpenRouter', category: 'Account login' },
        { name: 'Ollama', category: 'Local and custom' },
      ],
    },
    chips: { file: 'March.zip', skill: 'plan-mode', memory: 'prefers metric units' },
    command: 'Polish writing',
    composer: {
      text: 'What changed in the Q3 numbers?',
      model: 'Claude Sonnet 4.5',
      context: '200K',
    },
    dragged: 'March.pdf',
    brands: BRANDS,
  },
  zh: {
    tasks: {
      prompt: '总结三月的发票，标出异常的地方。',
      thinking: '先找到发票',
      todos: ['找到三月的发票', '逐个读取 PDF', '按供应商汇总', '标出异常', '写好总结'],
      grep: '搜索文件内容',
      bash: '运行命令',
      write: '写入文件',
      grepDetail: 'invoice',
      grepLines: ['发票/2026-03-acme.pdf', '发票/2026-03-globex.pdf'],
      bashLines: ['$ pdftotext -layout 发票/*.pdf -', 'Globex           合计  ¥9,850.00'],
      files: '5 个文件',
      result: 'summary.md',
      size: '2 KB',
      bashDetail: 'pdftotext -layout',
    },
    apps: {
      sentence: '帮我做一个习惯打卡应用',
      name: '习惯打卡',
      summary: '按周的打卡表，每个习惯每天一格。',
      week: '本周',
      habits: ['跑步', '读书 20 页', '不吃糖'],
    },
    automation: { name: '夜间摘要', schedule: '每天 2:00' },
    memory: {
      text: '偏好公制单位',
      suggestions: '建议',
      newSkill: '新技能',
      accept: '接受',
      dismiss: '忽略',
      created: '已创建技能 {{name}}。',
      skill: 'weekly-report',
      skillTitle: '根据我的笔记写周报',
    },
    skillsTitle: '技能',
    mcpTitle: 'MCP 服务',
    skills: SKILLS,
    mcpStates: { ready: '就绪', connecting: '正在连接…', signIn: '需要登录' },
    mcp: MCP,
    subagents: {
      run: '派发子智能体',
      items: [
        { title: '读取三月的发票', agent: 'reader' },
        { title: '与二月对比', agent: 'analyst' },
        { title: '核对供应商合同', agent: 'reviewer' },
      ],
    },
    providers: {
      title: '已连接的提供商',
      rows: [
        { name: 'ChatGPT', category: '账号登录' },
        { name: 'Anthropic', category: 'API 密钥' },
        { name: 'Google Gemini', category: 'API 密钥' },
        { name: 'OpenRouter', category: '账号登录' },
        { name: 'Ollama', category: '本地与自定义' },
      ],
    },
    chips: { file: 'March.zip', skill: 'plan-mode', memory: '偏好公制单位' },
    command: '润色文字',
    composer: { text: '第三季度的数字有什么变化？', model: 'Claude Sonnet 4.5', context: '200K' },
    dragged: 'March.pdf',
    brands: BRANDS,
  },
} as const satisfies Record<Lang, EverythingContent>;
