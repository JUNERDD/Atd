import type { Localized } from '../../i18n/lang';

/** Where the model runs: at a provider in the cloud, or on this Mac. */
export type ModelMode = 'cloud' | 'local';

/** What Atd keeps, all of it on this Mac. `model` is there only while a local model runs. */
export type KeptId = 'history' | 'memory' | 'setup' | 'keys' | 'model';

interface Line {
  name: string;
  detail: string;
}

interface PrivacyCopy {
  title: string;
  lede: string;
  /** The switch's accessible name, and one label per position. */
  modeLabel: string;
  modes: Record<ModelMode, string>;
  zones: { mac: string; out: string };
  kept: Record<Exclude<KeptId, 'model'>, Line>;
  /** The model's row: dimmed while it runs at a provider, lit once it runs here. */
  model: Record<ModelMode, Line>;
  /** What leaves the Mac: the task, or nothing at all. */
  out: Record<ModelMode, Line>;
  /** Things Atd never has, printed under the board. */
  never: readonly string[];
}

export const privacyCopy = {
  en: {
    title: 'Local by design.',
    lede: 'What Atd keeps stays on your Mac. A task leaves only for the model you choose, and with a local model it never leaves at all.',
    modeLabel: 'Where the model runs',
    modes: { cloud: 'Cloud model', local: 'Local model' },
    zones: { mac: 'Stays on your Mac', out: 'Leaves your Mac' },
    kept: {
      history: { name: 'Conversations', detail: 'Every task and its history' },
      memory: { name: 'Memory', detail: 'How you like to work' },
      setup: { name: 'Your setup', detail: 'Skills and commands' },
      keys: { name: 'API keys', detail: 'Locked in the Keychain' },
    },
    model: {
      cloud: { name: 'The model', detail: 'Or run one locally' },
      local: { name: 'The model', detail: 'Ollama, LM Studio or vLLM' },
    },
    out: {
      cloud: { name: 'The task you send', detail: 'Straight to the provider you chose' },
      local: { name: 'Nothing.', detail: 'The model runs on this Mac too.' },
    },
    never: ['No account to create', 'No Atd server in between', 'No usage tracking'],
  },
  zh: {
    title: '本地运行，设计使然。',
    lede: 'Atd 保存的一切都留在你的 Mac 上。任务只发往你选择的模型；用本地模型时，它根本不会离开这台 Mac。',
    modeLabel: '模型运行的位置',
    modes: { cloud: '云端模型', local: '本地模型' },
    zones: { mac: '留在你的 Mac 上', out: '离开你的 Mac' },
    kept: {
      history: { name: '对话', detail: '每个任务及其历史记录' },
      memory: { name: '记忆', detail: '你的工作习惯' },
      setup: { name: '你的配置', detail: '技能与命令' },
      keys: { name: 'API 密钥', detail: '锁在钥匙串中' },
    },
    model: {
      cloud: { name: '模型', detail: '也可以在本机运行' },
      local: { name: '模型', detail: 'Ollama、LM Studio 或 vLLM' },
    },
    out: {
      cloud: { name: '你发出的任务', detail: '直接发给你选择的提供商' },
      local: { name: '什么也没有。', detail: '模型也在这台 Mac 上运行。' },
    },
    never: ['无需注册账号', '没有 Atd 服务器中转', '不收集使用数据'],
  },
} satisfies Localized<PrivacyCopy>;
