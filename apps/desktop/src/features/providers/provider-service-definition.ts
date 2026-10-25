import type { ParseKeys } from 'i18next';
import type { ProviderCatalogEntry } from '../../client/providers/schema';

type CopyKey = ParseKeys<'providers'>;

export type ProviderPlanDefinition = {
  id: string;
  providerId: string;
  aliases: string;
  nameKey: CopyKey;
  descriptionKey: CopyKey;
  defaults: {
    nameKey?: CopyKey;
    authTypes?: readonly ProviderCatalogEntry['auth'][number]['type'][];
  };
} & (
  | { kind: 'builtin'; baseUrl?: string }
  | { kind: 'preset'; baseUrl: string; category: ProviderCatalogEntry['category'] }
);

export interface ProviderServiceDefinition {
  id: string;
  brand: string;
  nameKey: CopyKey;
  descriptionKey: CopyKey;
  aliases: string;
  plans: readonly ProviderPlanDefinition[];
}
