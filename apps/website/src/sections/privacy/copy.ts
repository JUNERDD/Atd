import type { Localized } from '../../i18n/lang';

export type NodeId = 'panel' | 'service' | 'keychain' | 'providers';

interface PrivacyCopy {
  /** The plate's printed name, as the nav calls the section. */
  label: string;
  title: string;
  lede: string;
  /** The schematic in words, for assistive tech: the drawing itself is hidden from it. */
  diagramLabel: string;
  boundary: string;
  nodes: Record<NodeId, { name: string; detail: string }>;
}

export const privacyCopy = {
  en: {
    label: 'Privacy',
    title: 'Local by design.',
    lede: 'Your data stays on your Mac. Tasks go only to the providers you connect, and their keys stay in the Keychain.',
    diagramLabel:
      'Diagram. On this Mac, the panel talks to the agent service on the loopback address, which reads keys from the Keychain. Only the service reaches out, to the model providers you connect.',
    boundary: 'This Mac',
    nodes: {
      panel: { name: 'Panel', detail: 'On your screen' },
      service: { name: 'Agent service', detail: '127.0.0.1 only' },
      keychain: { name: 'Keychain', detail: 'Your keys' },
      providers: { name: 'Model providers', detail: 'Only the ones you connect' },
    },
  },
  zh: {
    label: '隐私',
    title: '本地运行，设计使然。',
    lede: '数据留在你的 Mac 上。任务只发给你接入的提供商，密钥始终留在钥匙串中。',
    diagramLabel:
      '示意图。在这台 Mac 上，面板通过本机回环地址与智能体服务通信，服务从钥匙串读取密钥；只有服务会向外连接你接入的模型提供商。',
    boundary: '这台 Mac',
    nodes: {
      panel: { name: '面板', detail: '在你的屏幕上' },
      service: { name: '智能体服务', detail: '仅限 127.0.0.1' },
      keychain: { name: '钥匙串', detail: '你的密钥' },
      providers: { name: '模型提供商', detail: '只有你接入的那些' },
    },
  },
} satisfies Localized<PrivacyCopy>;
