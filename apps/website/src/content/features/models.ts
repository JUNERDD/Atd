import type { FeaturePage } from './types.ts';

export const models = {
  slug: 'models',
  illustration: { case: 'settings' },
  updated: '2026-11-18',
  related: ['privacy', 'automations', 'computer-use'],
  posts: ['atd-0-11-1', 'atd-0-11-0'],
  copy: {
    en: {
      name: 'Models',
      summary:
        'Use your own models: ChatGPT plan sign-in, API keys, cloud services, or local and custom endpoints.',
      headTitle: 'Use your own AI models and local LLMs on Mac — Atd',
      headDescription:
        'Connect Atd to the models you already use: sign in with a ChatGPT plan, add API keys, use cloud services, or run local models with Ollama or LM Studio.',
      title: 'Bring your own AI models to your Mac',
      lede: 'Atd brings no model of its own and needs no Atd account. Connect the providers you already use, from a ChatGPT plan or an API key to a model running on your own machine, and requests go straight to them.',
      sections: [
        {
          id: 'connection-types',
          title: 'Four ways to connect a model',
          paragraphs: [
            'Open Settings → Models and choose Add provider. The catalog groups providers by how you connect:',
          ],
          points: [
            'Account login: sign in with a ChatGPT plan or an OpenRouter account in your browser.',
            'API keys: OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, Groq, OpenRouter, Kimi (Moonshot), Z.AI and Zhipu BigModel, MiniMax, Alibaba Cloud Model Studio, Xiaomi MiMo and more.',
            'Cloud services: Amazon Bedrock, Azure, Google Vertex AI and Cloudflare; Bedrock and Vertex AI can use the AWS or Google Cloud credentials already configured on your Mac.',
            'Local and custom: Ollama, LM Studio, llama.cpp, vLLM, or a custom provider at any base URL.',
          ],
        },
        {
          id: 'chatgpt-plan',
          title: 'Use your ChatGPT plan instead of an API key',
          paragraphs: [
            'Add OpenAI, choose ChatGPT plan, and sign in to ChatGPT in your browser to use your plan’s allowance. Before you connect, Atd shows what the connection shares: it receives your account ID and email to identify the connection, and sends OpenAI the prompts, conversation context, attachments and tool results of your tasks.',
            'Allow background use is off by default. Turn it on only if scheduled tasks, automatic memory reviews and your apps’ AI requests should also draw on your plan, including while you’re away.',
          ],
        },
        {
          id: 'local-and-custom',
          title: 'Local models and custom endpoints',
          paragraphs: [
            'Run a model on your own machine with Ollama, LM Studio, llama.cpp or vLLM, and Atd fills in the runtime’s usual local address. An API key is optional, for servers that ask for one.',
            'A custom provider connects to any other endpoint by its base URL, with an API key or bearer token if needed. Add each model by its exact ID and set its protocol (OpenAI Chat Completions, OpenAI Responses or Anthropic Messages), context window, maximum output tokens, and whether it supports reasoning and image input. Plain HTTP endpoints, including internal hostnames, are accepted, with a warning when the address isn’t on your own Mac.',
          ],
        },
        {
          id: 'defaults-and-choice',
          title: 'Defaults per connection, a choice per task',
          paragraphs: [
            'Each connection keeps its own credentials and default model, and one connection is the default provider for new tasks. In the composer you can switch a task’s model and set its reasoning effort; tasks you already started keep the model they use.',
            'Other features can use their own model: saved commands in Settings → Commands, automations in Settings → Automations, and Screen understanding in Settings → Computer use, which can hand screens to an image-capable model.',
          ],
          points: [
            'Refresh models updates a connection’s model list.',
            'Verify model access sends one small request to confirm a connection works; it may use credits.',
            'Make default provider changes which connection new tasks start with.',
          ],
        },
        {
          id: 'credentials',
          title: 'Where your keys and requests go',
          paragraphs: [
            'API keys and sign-in tokens are stored in your Mac’s keychain. Requests go directly from your Mac to the providers you configure, never through an Atd server, and there is no Atd account to create.',
            'If macOS later blocks access to a saved credential, for example after an update changes the app’s signing certificate, Atd flags the affected connections in Settings → Models. Re-enter the key or sign in again, and the endpoints, custom models and default choices stay as they were.',
          ],
        },
      ],
      questions: [
        {
          question: 'Can I use Atd with local models like Ollama or LM Studio?',
          answer:
            'Yes. Add Ollama, LM Studio, llama.cpp or vLLM under Local and custom in Settings → Models. Atd fills in the runtime’s usual local address, and no API key is needed unless your server asks for one. Make it the default provider or pick its models per task; how well a local model handles tools and long tasks depends on the model you run.',
        },
        {
          question: 'Can I use my ChatGPT subscription instead of an API key?',
          answer:
            'Yes, if your ChatGPT account is eligible to share its plan. In Settings → Models, add OpenAI, choose ChatGPT plan, agree to what the connection shares, and sign in to ChatGPT in your browser. Requests then use your plan’s allowance, while automations and memory maintenance stay off it until you allow background use.',
        },
        {
          question: 'Does Atd send my API keys or prompts to an Atd server?',
          answer:
            'No. Credentials stay in your Mac’s keychain, and each request goes from your Mac directly to the provider of the model you chose. That provider receives your prompt, conversation context and any attachments or tool results in the task, under its own policies.',
        },
        {
          question: 'Can I connect an OpenAI-compatible server or gateway?',
          answer:
            'Yes. Add a custom provider under Local and custom, enter its base URL and, if it needs one, an API key or bearer token. Then add models by exact ID with the protocol each one speaks: OpenAI Chat Completions, OpenAI Responses or Anthropic Messages.',
        },
        {
          question: 'Can different tasks use different models?',
          answer:
            'Yes. New tasks start with the default provider’s default model, you can switch a task’s model in the composer, and a task keeps its model when you change the defaults. Saved commands, automations and screen understanding for computer use can each have their own model.',
        },
      ],
      keywords: [
        'bring your own API key',
        'use ChatGPT plan in a Mac app',
        'Ollama client for Mac',
        'LM Studio AI agent',
        'local LLM agent for Mac',
        'OpenAI-compatible endpoint',
        'Amazon Bedrock desktop app',
      ],
    },
    zh: {
      name: '模型',
      summary: '用你自己的模型：ChatGPT 订阅登录、API 密钥、云服务，或本地与自定义端点。',
      headTitle: 'Mac 接入自有模型与本地大模型 — Atd',
      headDescription:
        'Atd 接入你在用的模型：登录 ChatGPT 订阅、填写 API 密钥、连接云服务，或用 Ollama、LM Studio 运行本地模型。',
      title: '在 Mac 上接入你自己的 AI 模型',
      lede: 'Atd 不自带模型，也不需要 Atd 账号。接入你已经在用的提供商，从 ChatGPT 订阅、API 密钥，到在自己机器上运行的模型都可以，请求直接发给它们。',
      sections: [
        {
          id: 'connection-types',
          title: '四种接入方式',
          paragraphs: ['打开「设置 → 模型」，选择「添加提供商」。提供商目录按接入方式分类：'],
          points: [
            '账号登录：在浏览器中登录 ChatGPT 订阅或 OpenRouter 账号。',
            'API 密钥：OpenAI、Anthropic、Google、xAI、DeepSeek、Mistral、Groq、OpenRouter、Kimi（Moonshot）、Z.AI 与智谱 BigModel、MiniMax、阿里云百炼、Xiaomi MiMo 等。',
            '云服务：Amazon Bedrock、Azure、Google Vertex AI 和 Cloudflare；Bedrock 与 Vertex AI 可直接使用本机已配置的 AWS 或 Google Cloud 凭据。',
            '本地与自定义：Ollama、LM Studio、llama.cpp、vLLM，或填写任意基础 URL 的自定义提供商。',
          ],
        },
        {
          id: 'chatgpt-plan',
          title: '用 ChatGPT 订阅代替 API 密钥',
          paragraphs: [
            '添加 OpenAI，选择「ChatGPT 订阅」，在浏览器中登录 ChatGPT，即可使用订阅额度。连接前，Atd 会说明连接涉及的数据：它会获取你的账号 ID 和邮箱以识别此连接，并把任务中的提示词、对话上下文、附件和工具结果发送给 OpenAI。',
            '「允许后台调用」默认关闭。只有当你希望定时任务、自动记忆整理和应用的 AI 请求也使用订阅额度（包括你离开时）时，再打开它。',
          ],
        },
        {
          id: 'local-and-custom',
          title: '本地模型与自定义端点',
          paragraphs: [
            '用 Ollama、LM Studio、llama.cpp 或 vLLM 在自己的机器上运行模型，Atd 会自动填好这些运行环境常用的本地地址。API 密钥可选，服务端需要时再填。',
            '自定义提供商通过基础 URL 连接其他任意端点，需要时可填写 API 密钥或 bearer 令牌。按确切的模型 ID 添加每个模型，并设置协议（OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages）、上下文窗口、最大输出 token 数，以及是否支持推理和图像输入。也支持普通 HTTP 端点和内网主机名；地址不在本机时，表单会提示明文传输的风险。',
          ],
        },
        {
          id: 'defaults-and-choice',
          title: '每个连接有默认值，每个任务可单独选择',
          paragraphs: [
            '每个连接都有自己的凭据和默认模型，其中一个连接作为新任务的默认提供商。在输入框中可以为任务切换模型、设置推理强度；已经开始的任务会保留原来的模型。',
            '其他功能也能单独指定模型：已保存的命令在「设置 → 命令」中设置，自动化在「设置 → 自动化」中设置，「设置 → 电脑操作」的「画面理解」则可以交给支持图像的模型。',
          ],
          points: [
            '「刷新模型」会更新连接的模型列表。',
            '「校验模型访问」会发送一个小请求确认连接可用，可能消耗额度。',
            '「设为默认提供商」决定新任务从哪个连接开始。',
          ],
        },
        {
          id: 'credentials',
          title: '密钥存在哪里，请求发往哪里',
          paragraphs: [
            'API 密钥和登录凭据保存在 Mac 的钥匙串中。请求从你的 Mac 直接发往你配置的提供商，不经过任何 Atd 服务器，也无需注册 Atd 账号。',
            '如果之后 macOS 阻止读取已保存的凭据（例如更新改变了应用的签名证书），Atd 会在「设置 → 模型」中标出受影响的连接。重新输入密钥或重新登录即可恢复，端点、自定义模型和默认选择都会保留。',
          ],
        },
      ],
      questions: [
        {
          question: 'Atd 能用 Ollama、LM Studio 这样的本地模型吗？',
          answer:
            '可以。在「设置 → 模型」的「本地与自定义」中添加 Ollama、LM Studio、llama.cpp 或 vLLM，Atd 会填好常用的本地地址；除非服务端要求，否则不需要 API 密钥。你可以把它设为默认提供商，也可以按任务选择其中的模型。本地模型处理工具调用和长任务的效果，取决于你运行的模型本身。',
        },
        {
          question: '能用 ChatGPT 订阅代替 API 密钥吗？',
          answer:
            '可以，前提是你的 ChatGPT 账号符合共享订阅的条件。在「设置 → 模型」中添加 OpenAI，选择「ChatGPT 订阅」，同意连接说明后在浏览器中登录 ChatGPT。此后请求使用订阅额度；在你允许后台调用之前，自动化和记忆整理不会动用它。',
        },
        {
          question: 'Atd 会把我的 API 密钥或提示词发到 Atd 服务器吗？',
          answer:
            '不会。凭据保存在 Mac 的钥匙串中，每个请求都从你的 Mac 直接发往所选模型的提供商。提供商会收到任务中的提示词、对话上下文以及附件或工具结果，并按它自己的政策处理。',
        },
        {
          question: '能连接兼容 OpenAI 接口的服务或网关吗？',
          answer:
            '可以。在「本地与自定义」中添加自定义提供商，填写基础 URL，需要时再填 API 密钥或 bearer 令牌。然后按确切的模型 ID 添加模型，并选择各自使用的协议：OpenAI Chat Completions、OpenAI Responses 或 Anthropic Messages。',
        },
        {
          question: '不同任务能用不同的模型吗？',
          answer:
            '可以。新任务默认使用默认提供商的默认模型，你可以在输入框中为任务切换模型；之后修改默认设置，已有任务仍保留原来的模型。已保存的命令、自动化和电脑操作的画面理解也都可以单独指定模型。',
        },
      ],
      keywords: [
        '自带 API 密钥',
        'ChatGPT 订阅接入 Mac 应用',
        'Mac Ollama 客户端',
        'LM Studio AI 智能体',
        'Mac 本地大模型智能体',
        'OpenAI 兼容接口',
        '阿里云百炼 Mac 客户端',
      ],
    },
  },
} as const satisfies FeaturePage;
