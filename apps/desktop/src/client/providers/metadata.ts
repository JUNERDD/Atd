export const LOCAL_PROVIDERS = [
  { id: 'llamacpp', name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { id: 'vllm', name: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
  { id: 'openai-compatible', name: 'Custom provider', baseUrl: '' },
];
export const isCustom = (provider: string) => LOCAL_PROVIDERS.some((item) => item.id === provider);
export const isCloud = (provider: string) =>
  [
    'amazon-bedrock',
    'azure',
    'google-vertex',
    'cloudflare-ai-gateway',
    'cloudflare-workers-ai',
  ].includes(provider);

export const CLOUD_FIELDS: Record<
  string,
  Array<{ key: string; label: string; placeholder: string }>
> = {
  azure: [
    { key: 'AZURE_OPENAI_API_VERSION', label: 'API version', placeholder: '2025-04-01-preview' },
    {
      key: 'AZURE_OPENAI_DEPLOYMENT_NAME_MAP',
      label: 'Model to deployment mapping',
      placeholder: 'gpt-4.1=my-deployment',
    },
  ],
  'amazon-bedrock': [
    { key: 'AWS_REGION', label: 'AWS region', placeholder: 'us-east-1' },
    { key: 'AWS_PROFILE', label: 'AWS profile', placeholder: 'default' },
  ],
  'google-vertex': [
    { key: 'GOOGLE_CLOUD_PROJECT', label: 'Project ID', placeholder: 'my-project' },
    { key: 'GOOGLE_CLOUD_LOCATION', label: 'Location', placeholder: 'us-central1' },
    {
      key: 'GOOGLE_APPLICATION_CREDENTIALS',
      label: 'Service account file (optional)',
      placeholder: '/path/to/credentials.json',
    },
  ],
  'cloudflare-workers-ai': [
    { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID', placeholder: 'Account ID' },
  ],
  'cloudflare-ai-gateway': [
    { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID', placeholder: 'Account ID' },
    { key: 'CLOUDFLARE_GATEWAY_ID', label: 'Gateway ID', placeholder: 'Gateway ID' },
  ],
};

export const isAmbient = (provider: string) =>
  provider === 'amazon-bedrock' || provider === 'google-vertex';
