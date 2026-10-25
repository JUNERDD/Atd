import type { ProviderServiceDefinition } from './provider-service-definition';
import { SUBSCRIPTION_PROVIDER_SERVICES } from './provider-presets-subscriptions';
import { TOKEN_PROVIDER_SERVICES } from './provider-presets-tokens';

/** Explicit service/account boundaries; neither provider names nor shared logos imply grouping. */
export const PROVIDER_SERVICES: readonly ProviderServiceDefinition[] = [
  {
    id: 'openai',
    brand: 'openai',
    nameKey: 'openai.name',
    descriptionKey: 'openai.description',
    aliases: 'OpenAI ChatGPT GPT',
    plans: [
      {
        id: 'openai-chatgpt',
        providerId: 'openai',
        kind: 'builtin',
        aliases: 'ChatGPT OAuth Account 账号 登录',
        nameKey: 'openai.chatgpt.planName',
        descriptionKey: 'openai.chatgpt.planDescription',
        defaults: {
          nameKey: 'openai.chatgpt.connectionName',
          authTypes: ['oauth'],
        },
      },
      {
        id: 'openai-api',
        providerId: 'openai',
        kind: 'builtin',
        aliases: 'OpenAI API API Key Platform 按量 密钥 开放平台',
        nameKey: 'openai.api.planName',
        descriptionKey: 'openai.api.planDescription',
        defaults: {
          nameKey: 'openai.api.connectionName',
          authTypes: ['api_key'],
        },
      },
    ],
  },
  {
    id: 'zai',
    brand: 'zai',
    nameKey: 'zhipu.internationalCoding.name',
    descriptionKey: 'zhipu.internationalCoding.description',
    aliases: 'Z.AI ZAI International Global 国际',
    plans: [
      {
        id: 'zai',
        providerId: 'zai',
        kind: 'builtin',
        aliases: 'Z.AI Coding Plan International Global 国际',
        nameKey: 'zhipu.internationalCoding.planName',
        descriptionKey: 'zhipu.internationalCoding.planDescription',
        defaults: { nameKey: 'zhipu.internationalCoding.connectionName' },
      },
      {
        id: 'zai-api',
        providerId: 'openai-compatible',
        kind: 'preset',
        baseUrl: 'https://api.z.ai/api/paas/v4',
        category: 'api',
        aliases: 'Z.AI International Global API 按量 国际',
        nameKey: 'plans.apiName',
        descriptionKey: 'plans.apiDescription',
        defaults: { nameKey: 'zhipu.internationalApi.connectionName', authTypes: ['api_key'] },
      },
    ],
  },
  {
    id: 'bigmodel-cn',
    brand: 'zai-coding-cn',
    nameKey: 'zhipu.china.name',
    descriptionKey: 'zhipu.china.description',
    aliases: '智谱 BigModel Zhipu CN China 国内 中国',
    plans: [
      {
        id: 'zai-coding-cn',
        providerId: 'zai-coding-cn',
        kind: 'builtin',
        aliases: 'Z.AI Coding CN Coding Plan GLM 编程套餐',
        nameKey: 'zhipu.chinaCoding.planName',
        descriptionKey: 'zhipu.chinaCoding.planDescription',
        defaults: { nameKey: 'zhipu.chinaCoding.connectionName' },
      },
      {
        id: 'zhipu-api-cn',
        providerId: 'openai-compatible',
        kind: 'preset',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        category: 'api',
        aliases: 'BigModel Zhipu CN China API 按量 Pay as you go',
        nameKey: 'zhipu.chinaApi.planName',
        descriptionKey: 'zhipu.chinaApi.planDescription',
        defaults: {
          nameKey: 'zhipu.chinaApi.connectionName',
          authTypes: ['api_key'],
        },
      },
    ],
  },
  ...SUBSCRIPTION_PROVIDER_SERVICES,
  ...TOKEN_PROVIDER_SERVICES,
];
