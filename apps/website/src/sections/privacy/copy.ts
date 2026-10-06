import type { Localized } from '../../i18n/lang';

export type NodeId = 'panel' | 'relay' | 'service' | 'keychain' | 'providers';

interface PrivacyCopy {
  kicker: string;
  title: string;
  lede: string;
  figure: string;
  diagramLabel: string;
  boundary: string;
  nodes: Record<NodeId, { name: string; detail: string }>;
  points: { title: string; body: string }[];
}

export const privacyCopy = {
  en: {
    kicker: 'Privacy',
    title: 'Local by design.',
    lede: 'The agent service runs on your Mac and listens only to it. Your tasks go to the model providers you connect, and their keys stay in the Keychain.',
    figure: 'Fig. 1 · Where a request goes',
    diagramLabel:
      'Diagram. On this Mac, the panel talks to a relay, the relay to the agent service on the loopback address, and the service reads secrets from the Keychain. The service sends task requests to the model providers you connect.',
    boundary: 'This Mac',
    nodes: {
      panel: { name: 'Panel', detail: 'Native shell' },
      relay: { name: 'Relay', detail: 'Adds the token' },
      service: { name: 'Agent service', detail: '127.0.0.1 only' },
      keychain: { name: 'Keychain', detail: 'Provider and MCP secrets' },
      providers: { name: 'Model providers', detail: 'The ones you connect' },
    },
    points: [
      {
        title: 'Loopback only',
        body: 'The service listens on 127.0.0.1 and answers only requests that carry its bearer token.',
      },
      {
        title: 'Secrets in the Keychain',
        body: 'Provider and MCP secrets live in the macOS Keychain and never reach the interface.',
      },
      {
        title: 'A typed bridge',
        body: 'The interface reaches native features only through a typed bridge that validates every message.',
      },
      {
        title: 'Your data stays here',
        body: 'Your data stays on your Mac, in ~/Library/Application Support/AgentService.',
      },
    ],
  },
  zh: {
    kicker: '隐私',
    title: '本地运行，设计使然。',
    lede: '智能体服务运行在你的 Mac 上，只接受本机的连接。任务会发送给你接入的模型提供商，它们的密钥始终留在钥匙串中。',
    figure: '图 1 · 请求的去向',
    diagramLabel:
      '示意图。在这台 Mac 上，面板与中继通信，中继通过本机回环地址与智能体服务通信，服务从钥匙串读取密钥；服务把任务请求发送给你接入的模型提供商。',
    boundary: '这台 Mac',
    nodes: {
      panel: { name: '面板', detail: '原生外壳' },
      relay: { name: '中继', detail: '附加访问令牌' },
      service: { name: '智能体服务', detail: '仅限 127.0.0.1' },
      keychain: { name: '钥匙串', detail: '提供商与 MCP 密钥' },
      providers: { name: '模型提供商', detail: '你接入的那些' },
    },
    points: [
      {
        title: '只走本机回环',
        body: '服务只监听 127.0.0.1，并且只响应带有访问令牌的请求。',
      },
      {
        title: '密钥存于钥匙串',
        body: '提供商和 MCP 的密钥保存在 macOS 钥匙串中，从不进入界面。',
      },
      {
        title: '类型化桥接',
        body: '界面只能通过类型化的桥接调用原生功能，每条消息都会经过校验。',
      },
      {
        title: '数据留在本机',
        body: '你的数据留在这台 Mac 上，位于 ~/Library/Application Support/AgentService。',
      },
    ],
  },
} satisfies Localized<PrivacyCopy>;
