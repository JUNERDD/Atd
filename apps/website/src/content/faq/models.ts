import type { FaqGroup } from './types.ts';

/** Which models Atd works with, local models, and using a ChatGPT plan. */
export const models = {
  id: 'models-and-cost',
  title: { en: 'Models and cost', zh: '模型与费用' },
  entries: [
    {
      id: 'which-models',
      question: { en: 'Which AI models can I use with Atd?', zh: 'Atd 能用哪些 AI 模型？' },
      answer: {
        en: [
          'Atd works with the models you connect in Settings → Models. Its catalog covers cloud providers such as OpenAI, Anthropic, Google, DeepSeek, Mistral and OpenRouter, cloud services such as Amazon Bedrock, Azure and Google Vertex AI, and local or custom endpoints.',
          'Connect with an account sign-in where a provider supports it, an API key, or a local endpoint. Each connection keeps its own credentials and default model; new tasks use the default provider and model you choose, and existing tasks keep the model they started with.',
        ],
        zh: [
          'Atd 使用你在“设置 → 模型”中接入的模型。内置目录涵盖 OpenAI、Anthropic、Google、DeepSeek、Mistral、OpenRouter 等云端提供商，Amazon Bedrock、Azure、Google Vertex AI 等云服务，以及本地或自定义端点。',
          '连接方式可以是提供商支持的账号登录、API 密钥或本地端点。每个连接有各自的凭据和默认模型；新任务使用你选定的默认提供商与模型，已有任务则保留开始时的模型。',
        ],
      },
      see: 'models',
    },
    {
      id: 'local-models',
      question: { en: 'Can I use local models with Atd?', zh: 'Atd 能用本地模型吗？' },
      answer: {
        en: [
          'Yes. In Settings → Models, under Local and custom, connect llama.cpp, Ollama, LM Studio or vLLM, or add any OpenAI-compatible server as a Custom provider. Local connections work without an API key, and Atd reads the list of available models from the server.',
          'With a local model, model requests go to that server instead of a cloud provider. Tools you allow in a task, such as web search or MCP servers, can still reach the services they use.',
        ],
        zh: [
          '可以。在“设置 → 模型”的“本地与自定义”中，可以连接 llama.cpp、Ollama、LM Studio 或 vLLM，也可以把任何兼容 OpenAI 接口的服务器添加为 Custom provider（自定义提供商）。本地连接无需 API 密钥，Atd 会直接从服务器读取可用的模型列表。',
          '使用本地模型时，模型请求会发往这台服务器，而不是云端提供商；不过任务中你允许使用的工具（例如网页搜索或 MCP 服务器）仍可能访问它们各自的服务。',
        ],
      },
      see: 'models',
    },
    {
      id: 'chatgpt-plan',
      question: {
        en: 'Can I use my ChatGPT subscription with Atd?',
        zh: 'Atd 能用我的 ChatGPT 订阅吗？',
      },
      answer: {
        en: [
          'Yes, if your account is eligible. In Settings → Models, add OpenAI, choose ChatGPT plan, agree to what the connection shares, and sign in to ChatGPT. Requests then use your plan’s allowance instead of pay-as-you-go API billing, and there is no Atd fee for the connection.',
          'Background use is off by default. To let automations, memory maintenance and apps use the plan while you’re away, turn on Allow background use in that connection’s settings. You can also connect OpenAI with an API key instead.',
        ],
        zh: [
          '可以，前提是你的账号符合条件。在“设置 → 模型”中添加 OpenAI，选择“ChatGPT 订阅”，同意连接所共享的内容后登录 ChatGPT。之后的请求会使用订阅额度，而不是按量计费的 API；这个连接也不需要向 Atd 付费。',
          '后台调用默认关闭。如果想让自动化、记忆整理和应用在你离开时也使用订阅额度，请在该连接的设置中开启“允许后台调用”。你也可以改用 API 密钥连接 OpenAI。',
        ],
      },
      see: 'models',
    },
  ],
} as const satisfies FaqGroup;
