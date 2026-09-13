import openai from '@ai/ui/assets/brands/openai.svg';
const assets = import.meta.glob<string>(
  '../../../../../packages/ui/src/assets/brands/lndev/*.svg',
  { eager: true, query: '?url', import: 'default' },
);
const names: Record<string, string> = {
  anthropic: 'anthropic',
  google: 'google-gemini-symbol',
  'google-vertex': 'google-cloud',
  'amazon-bedrock': 'amazon-aws',
  'azure-openai-responses': 'microsoft-azure',
  xai: 'x-ai',
  nvidia: 'nvidia-symbol',
  mistral: 'mistral-ai',
  moonshotai: 'moonshot-ai',
  'moonshotai-cn': 'moonshot-ai',
  'kimi-coding': 'kimi',
  'github-copilot': 'github-copilot',
  huggingface: 'hugging-face',
  together: 'together-ai',
  'vercel-ai-gateway': 'vercel',
  'cloudflare-workers-ai': 'cloudflare',
  'cloudflare-ai-gateway': 'cloudflare',
  'minimax-cn': 'minimax',
  'opencode-go': 'opencode',
};
export function ProviderBrand({ provider }: { provider: string }) {
  const stem =
    names[provider] ??
    (provider.startsWith('qwen-') ? 'qwen' : provider.startsWith('xiaomi-') ? 'xiaomi' : provider);
  const asset =
    provider === 'openai' || provider === 'openai-codex'
      ? openai
      : Object.entries(assets).find(([path]) => path.endsWith(`/${stem}.svg`))?.[1];
  if (!asset) return <span aria-hidden="true" className="provider-brand" />;
  if (
    [
      'openai',
      'openai-codex',
      'anthropic',
      'amazon-bedrock',
      'moonshotai',
      'moonshotai-cn',
      'openrouter',
      'xai',
      'ollama',
      'lm-studio',
      'github-copilot',
      'vercel-ai-gateway',
    ].includes(provider)
  )
    return (
      <span
        aria-hidden="true"
        className="provider-brand provider-brand-mask"
        style={{ maskImage: `url("${asset}")` }}
      />
    );
  return <img src={asset} width={16} height={16} className="provider-brand" alt="" />;
}
